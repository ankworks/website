/**
 * GitHub OAuth sign-in, encrypted session cookies, and permission detection.
 *
 * Security model (Milestone B):
 * - The GitHub access token is stored ONLY inside an AES-GCM encrypted,
 *   HttpOnly, Secure, SameSite=Lax cookie. It is never written to
 *   localStorage/sessionStorage/URLs and never included in any JSON response.
 * - OAuth `state` is a random value bound to a short-lived CSRF cookie and
 *   verified on callback (fail closed on any mismatch).
 * - Missing OAuth/encryption secrets disable sign-in entirely
 *   (503 AUTH_NOT_CONFIGURED) — nothing is faked or bypassed.
 * - Permission detection always uses the signed-in user's own token and fails
 *   closed (401/404) when identity or repository access cannot be proven.
 */

import { OAUTH_STATE_COOKIE, SESSION_COOKIE } from '../shared/auth';
import type { AuthPermissionsResponse, AuthSessionResponse, AuthUser, RepoRole } from '../types/auth';
import type { Env } from './env';
import { API_SECURITY_HEADERS, UpstreamError, errorResponse } from './github-client';
import { logEvent } from './logging';

export { OAUTH_STATE_COOKIE, SESSION_COOKIE };

/** Session lifetime: 30 days. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** OAuth state cookie lifetime: 10 minutes. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
/** Associated data for AES-GCM so a cookie can never be replayed as another kind of blob. */
const SESSION_AAD = 'ankworks-forge-session-v1';
const MIN_ENCRYPTION_KEY_LENGTH = 16;

/** Encrypted session contents. Lives only inside the sealed cookie value. */
export interface SessionPayload {
  v: 1;
  user: AuthUser;
  /** GitHub access token — never logged, never returned to the browser. */
  token: string;
  /** Issued at (unix seconds). */
  iat: number;
  /** Expiry (unix seconds). */
  exp: number;
}

/** Sign-in is available only when the OAuth app and the encryption key exist. */
export function authConfigured(env: Env): boolean {
  return Boolean(
    env.GITHUB_APP_CLIENT_ID &&
      env.GITHUB_APP_CLIENT_SECRET &&
      env.SESSION_ENCRYPTION_KEY &&
      env.SESSION_ENCRYPTION_KEY.length >= MIN_ENCRYPTION_KEY_LENGTH
  );
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function cookieString(name: string, value: string, maxAge: number, path: string): string {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=${maxAge}`;
}

function clearCookie(name: string, path: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=0`;
}

// ---------------------------------------------------------------------------
// Session crypto (AES-256-GCM)
// ---------------------------------------------------------------------------

function b64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Seal a session payload into `iv.ciphertext` (base64url). Exported for tests. */
export async function encryptSession(payload: SessionPayload, secret: string): Promise<string> {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const additionalData = new TextEncoder().encode(SESSION_AAD);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, plaintext);
  return `${b64urlEncode(iv)}.${b64urlEncode(new Uint8Array(ciphertext))}`;
}

/**
 * Open a sealed session cookie. Returns null for every failure mode
 * (malformed, tampered, wrong key, wrong shape, expired) — fail closed.
 */
export async function decryptSession(value: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<SessionPayload | null> {
  try {
    const [ivPart, ctPart] = value.split('.');
    if (!ivPart || !ctPart) return null;
    const key = await deriveKey(secret);
    const additionalData = new TextEncoder().encode(SESSION_AAD);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlDecode(ivPart), additionalData },
      key,
      b64urlDecode(ctPart)
    );
    const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const candidate = parsed as Partial<SessionPayload>;
    if (
      candidate.v !== 1 ||
      typeof candidate.token !== 'string' ||
      candidate.token.length === 0 ||
      typeof candidate.iat !== 'number' ||
      typeof candidate.exp !== 'number' ||
      typeof candidate.user !== 'object' ||
      candidate.user === null ||
      typeof (candidate.user as AuthUser).login !== 'string' ||
      typeof (candidate.user as AuthUser).id !== 'number'
    ) {
      return null;
    }
    if (candidate.exp <= nowSeconds) return null;
    return candidate as SessionPayload;
  } catch {
    return null;
  }
}

export async function readSession(request: Request, env: Env): Promise<SessionPayload | null> {
  if (!env.SESSION_ENCRYPTION_KEY) return null;
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw) return null;
  return decryptSession(raw, env.SESSION_ENCRYPTION_KEY);
}

// ---------------------------------------------------------------------------
// Response helpers (auth responses must never be cached)
// ---------------------------------------------------------------------------

function authJson(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...API_SECURITY_HEADERS,
      ...extraHeaders,
    },
  });
}

function redirect(location: string, setCookies: string[]): Response {
  const response = new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      ...API_SECURITY_HEADERS,
    },
  });
  for (const cookie of setCookies) response.headers.append('Set-Cookie', cookie);
  return response;
}

function methodNotAllowed(allow: string): Response {
  const response = errorResponse(405, 'METHOD_NOT_ALLOWED', `Only ${allow} is supported.`);
  response.headers.set('Allow', allow);
  return response;
}

// ---------------------------------------------------------------------------
// OAuth flow
// ---------------------------------------------------------------------------

function redirectUriFor(request: Request): string {
  return new URL('/api/auth/callback', request.url).toString();
}

function authorizeUrl(env: Env, redirectUri: string, state: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', env.GITHUB_APP_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'read:user');
  return url.toString();
}

/** Exchange the OAuth code for an access token. Throws UpstreamError on failure. */
async function exchangeCode(env: Env, code: string, redirectUri: string): Promise<string> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'ankworks-forge',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_APP_CLIENT_ID,
      client_secret: env.GITHUB_APP_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!response.ok) {
    logEvent('warn', 'auth_exchange_failed', { status: response.status });
    throw new UpstreamError(502, 'GITHUB_AUTH_UNAVAILABLE', 'GitHub OAuth token exchange failed.');
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new UpstreamError(502, 'GITHUB_AUTH_UNAVAILABLE', 'GitHub OAuth token exchange returned an unreadable body.');
  }
  const record = (data ?? {}) as Record<string, unknown>;
  if (typeof record.access_token !== 'string' || record.access_token.length === 0) {
    logEvent('warn', 'auth_exchange_rejected', { error: typeof record.error === 'string' ? record.error : 'missing_token' });
    throw new UpstreamError(401, 'OAUTH_EXCHANGE_FAILED', 'GitHub rejected the OAuth credentials.');
  }
  return record.access_token;
}

/** Fetch the signed-in user's profile with their own token. */
async function fetchGitHubUser(token: string): Promise<AuthUser> {
  const response = await fetch('https://api.github.com/user', {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ankworks-forge',
    },
  });
  if (!response.ok) {
    logEvent('warn', 'auth_user_failed', { status: response.status });
    throw new UpstreamError(401, 'OAUTH_USER_FAILED', 'Could not load the GitHub user profile.');
  }
  const data = (await response.json()) as Record<string, unknown>;
  if (typeof data.id !== 'number' || typeof data.login !== 'string') {
    throw new UpstreamError(401, 'OAUTH_USER_FAILED', 'GitHub returned an unexpected user profile.');
  }
  return {
    id: data.id,
    login: data.login,
    name: typeof data.name === 'string' ? data.name : null,
    avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : '',
    htmlUrl: typeof data.html_url === 'string' ? data.html_url : `https://github.com/${data.login}`,
  };
}

function handleLogin(request: Request, env: Env): Response {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  if (!authConfigured(env)) {
    return authJson(
      { error: 'AUTH_NOT_CONFIGURED', message: 'GitHub sign-in is not configured for this deployment.', status: 503 },
      503
    );
  }
  const state = b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const location = authorizeUrl(env, redirectUriFor(request), state);
  return redirect(location, [
    cookieString(OAUTH_STATE_COOKIE, state, OAUTH_STATE_TTL_SECONDS, '/api/auth'),
  ]);
}

/** Failure codes surfaced via `?auth_error=` on the redirect back to the app. */
type CallbackFailure = 'OAUTH_STATE_MISMATCH' | 'OAUTH_EXCHANGE_FAILED' | 'OAUTH_USER_FAILED';

function callbackFailure(request: Request, code: CallbackFailure, clearState: boolean): Response {
  logEvent('warn', 'auth_callback_failed', { code });
  const location = new URL('/', request.url);
  location.searchParams.set('auth_error', code);
  const cookies = clearState ? [clearCookie(OAUTH_STATE_COOKIE, '/api/auth')] : [];
  return redirect(location.toString(), cookies);
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stateCookie = readCookie(request, OAUTH_STATE_COOKIE);
  if (!authConfigured(env)) {
    return authJson(
      { error: 'AUTH_NOT_CONFIGURED', message: 'GitHub sign-in is not configured for this deployment.', status: 503 },
      503
    );
  }
  // CSRF: both values must exist and match exactly. Fail closed.
  if (!state || !stateCookie || state !== stateCookie || !code) {
    return callbackFailure(request, 'OAUTH_STATE_MISMATCH', Boolean(stateCookie));
  }

  let token: string;
  try {
    token = await exchangeCode(env, code, redirectUriFor(request));
  } catch {
    // Token exchange failures (rejected code OR upstream outage) both land on
    // the app with a generic error code — this is a top-level navigation.
    return callbackFailure(request, 'OAUTH_EXCHANGE_FAILED', true);
  }

  let user: AuthUser;
  try {
    user = await fetchGitHubUser(token);
  } catch {
    return callbackFailure(request, 'OAUTH_USER_FAILED', true);
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { v: 1, user, token, iat: now, exp: now + SESSION_TTL_SECONDS };
  const sealed = await encryptSession(payload, env.SESSION_ENCRYPTION_KEY as string);
  logEvent('debug', 'auth_login', { login: user.login });
  return redirect(new URL('/', request.url).toString(), [
    cookieString(SESSION_COOKIE, sealed, SESSION_TTL_SECONDS, '/'),
    clearCookie(OAUTH_STATE_COOKIE, '/api/auth'),
  ]);
}

// ---------------------------------------------------------------------------
// Session / logout / permissions
// ---------------------------------------------------------------------------

function toAuthUser(user: AuthUser): AuthUser {
  return { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl, htmlUrl: user.htmlUrl };
}

async function handleSession(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const session = await readSession(request, env);
  const body: AuthSessionResponse = {
    authenticated: session !== null,
    user: session ? toAuthUser(session.user) : null,
    expiresAt: session ? new Date(session.exp * 1000).toISOString() : null,
    authEnabled: authConfigured(env),
  };
  return authJson(body);
}

function handleLogout(request: Request): Response {
  if (request.method !== 'POST') return methodNotAllowed('POST');
  logEvent('debug', 'auth_logout', {});
  const response = authJson({ ok: true });
  response.headers.append('Set-Cookie', clearCookie(SESSION_COOKIE, '/'));
  response.headers.append('Set-Cookie', clearCookie(OAUTH_STATE_COOKIE, '/api/auth'));
  return response;
}

const OWNER_REPO_PATTERN = /^[A-Za-z0-9_.-]+$/;

function roleFrom(permissions: Record<string, unknown>): RepoRole {
  if (permissions.admin === true) return 'admin';
  if (permissions.maintain === true) return 'maintain';
  if (permissions.push === true) return 'write';
  if (permissions.triage === true) return 'triage';
  return 'read';
}

async function handlePermissions(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET');
  const session = await readSession(request, env);
  if (!session) {
    return authJson({ error: 'UNAUTHENTICATED', message: 'Sign in to detect repository permissions.', status: 401 }, 401);
  }
  const url = new URL(request.url);
  const owner = url.searchParams.get('owner') ?? '';
  const repo = url.searchParams.get('repo') ?? '';
  if (!OWNER_REPO_PATTERN.test(owner) || !OWNER_REPO_PATTERN.test(repo)) {
    return authJson({ error: 'INVALID_PARAMETER', message: 'owner and repo are required.', status: 400 }, 400);
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${session.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ankworks-forge',
    },
  });
  if (response.status === 404) {
    return authJson(
      { error: 'REPOSITORY_NOT_FOUND', message: 'Repository not found or not visible to you.', status: 404 },
      404
    );
  }
  if (!response.ok) {
    throw new UpstreamError(502, 'GITHUB_AUTH_UNAVAILABLE', 'Could not verify repository permissions.');
  }
  const data = (await response.json()) as Record<string, unknown>;
  const permissions = (data.permissions ?? {}) as Record<string, unknown>;
  const role = roleFrom(permissions);
  const body: AuthPermissionsResponse = {
    owner,
    repo,
    canRead: true,
    canWrite: role === 'admin' || role === 'maintain' || role === 'write',
    canTriage: role !== 'read',
    canAdmin: role === 'admin',
    role,
    source: 'user-token',
  };
  return authJson(body);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** Dispatch for every /api/auth/* request. Handles its own method gating. */
export async function handleAuthRoute(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  switch (path) {
    case '/api/auth/login':
      return handleLogin(request, env);
    case '/api/auth/callback':
      return handleCallback(request, env);
    case '/api/auth/session':
      return handleSession(request, env);
    case '/api/auth/logout':
      return handleLogout(request);
    case '/api/auth/permissions':
      return handlePermissions(request, env);
    default:
      return errorResponse(404, 'NOT_FOUND', 'API endpoint not found.');
  }
}
