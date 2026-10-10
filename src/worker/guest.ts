/**
 * Guest issue submission with Turnstile verification and a moderation queue
 * (Milestone E).
 *
 * Public flow: `POST /api/guest/issues` verifies a Cloudflare Turnstile token,
 * rate-limits per client address, and stores a PENDING row in D1. Emails live
 * only in D1 — they never appear in responses, GitHub issues, or logs.
 *
 * Admin flow (session + repository admin, fail closed):
 *   GET  /api/admin/moderation?state=   list submissions (admin sees emails)
 *   POST /api/admin/moderation/:id/approve  create the GitHub issue with the
 *        ADMIN's own user token (never an installation token), without the
 *        guest's email, then email the guest about the outcome.
 *   POST /api/admin/moderation/:id/reject   mark rejected (+ notify).
 *
 * Every secret/binding this feature needs is optional at the deployment level:
 * when D1 or the Turnstile secret is missing the feature is OFF (503) — never
 * half-open. Required additions for activation are documented in the README.
 */

import { ORG_NAME } from '../shared/validation';
import { readSession } from './auth';
import type { Env } from './env';
import { errorResponse, jsonResponse } from './github-client';
import { logEvent } from './logging';

const CATEGORIES = ['bug', 'feature', 'question', 'other'] as const;
const NAME_MAX = 100;
const EMAIL_MAX = 200;
const TITLE_MAX = 200;
const BODY_MAX = 5000;
const RATE_LIMIT_PER_HOUR = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Category = (typeof CATEGORIES)[number];

export interface GuestIssueRow {
  id: number;
  created_at: string;
  name: string;
  email: string;
  category: Category;
  title: string;
  body: string;
  state: 'pending' | 'approved' | 'rejected';
  issue_number: number | null;
  ip_hash: string;
}

function apiHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ankworks-forge',
    'Content-Type': 'application/json',
  };
}

function guestEnabled(env: Env): boolean {
  return Boolean(env.DB && env.TURNSTILE_SECRET_KEY);
}

function disabled(): Response {
  return errorResponse(
    503,
    'GUEST_SUBMISSION_DISABLED',
    'Guest issue submission is not enabled on this deployment (needs the D1 binding and the Turnstile secret).'
  );
}

async function readRequestBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > 50_000) return null;
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Stable per-client hash for rate limiting — never the raw address. */
async function hashIp(remoteIp: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ankworks-guest:${remoteIp}`));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyTurnstile(env: Env, token: string, remoteIp: string): Promise<boolean> {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: remoteIp }),
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    // Fail closed when the verifier is unreachable.
    return false;
  }
}

async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'AnkWorks Forge <no-reply@ankb.qzz.io>',
        to: [to],
        subject,
        text,
      }),
    });
    logEvent('debug', 'guest_email_sent', {});
  } catch {
    // Email delivery is best-effort; moderation state already committed.
  }
}

/** Public payload — NEVER includes the email. */
function publicRow(row: GuestIssueRow): Record<string, unknown> {
  return {
    id: row.id,
    created_at: row.created_at,
    name: row.name,
    category: row.category,
    title: row.title,
    body: row.body,
    state: row.state,
    issue_number: row.issue_number,
  };
}

function adminRow(row: GuestIssueRow): Record<string, unknown> {
  return { ...publicRow(row), email: row.email };
}

/** Require a session whose user has admin on the repository (fail closed). */
async function requireAdmin(env: Env, request: Request): Promise<string | null> {
  const session = await readSession(request, env);
  if (!session) return null;
  try {
    const response = await fetch(`https://api.github.com/repos/${ORG_NAME}/website`, {
      method: 'GET',
      redirect: 'manual',
      headers: apiHeaders(session.token),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { permissions?: Record<string, unknown> };
    return data.permissions?.admin === true ? session.token : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST /api/guest/issues
// ---------------------------------------------------------------------------

async function handleGuestSubmit(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only POST is supported.');
    response.headers.set('Allow', 'POST');
    return response;
  }
  if (!guestEnabled(env)) return disabled();

  const body = await readRequestBody(request);
  if (!body) return errorResponse(400, 'INVALID_BODY', 'A JSON body is required.');

  // Honeypot: real users never fill this field. Pretend success, store nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return jsonResponse({ id: 0, status: 'pending' }, 0);
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const category = typeof body.category === 'string' && (CATEGORIES as readonly string[]).includes(body.category) ? (body.category as Category) : null;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';

  if (name.length === 0 || name.length > NAME_MAX) return errorResponse(400, 'INVALID_NAME', 'A name is required.');
  if (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX) return errorResponse(400, 'INVALID_EMAIL', 'A valid email is required.');
  if (!category) return errorResponse(400, 'INVALID_CATEGORY', 'category must be bug, feature, question, or other.');
  if (title.length === 0 || title.length > TITLE_MAX) return errorResponse(400, 'INVALID_TITLE', 'A title is required.');
  if (text.length === 0 || text.length > BODY_MAX) return errorResponse(400, 'INVALID_BODY', 'A description is required.');

  const remoteIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const ipHash = await hashIp(remoteIp);

  // Rate limit: submissions in the last hour from this client.
  const db = env.DB as D1Database;
  const recent = await db
    .prepare("SELECT COUNT(*) AS n FROM guest_issues WHERE ip_hash = ?1 AND created_at > datetime('now', '-1 hour')")
    .bind(ipHash)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return errorResponse(429, 'RATE_LIMITED', 'Too many submissions. Please try again later.', 3600);
  }

  if (token.length === 0) return errorResponse(403, 'CAPTCHA_REQUIRED', 'Complete the Turnstile challenge first.');
  if (!(await verifyTurnstile(env, token, remoteIp))) {
    logEvent('warn', 'guest_captcha_failed', {});
    return errorResponse(403, 'CAPTCHA_FAILED', 'Turnstile verification failed.');
  }

  const result = await db
    .prepare('INSERT INTO guest_issues (name, email, category, title, body, ip_hash, state) VALUES (?1, ?2, ?3, ?4, ?5, ?6, \'pending\') RETURNING id, created_at')
    .bind(name, email, category, title, text, ipHash)
    .first<{ id: number; created_at: string }>();

  logEvent('debug', 'guest_issue_submitted', { category });
  if (env.MODERATION_NOTIFY_EMAIL) {
    void sendEmail(
      env,
      env.MODERATION_NOTIFY_EMAIL,
      `[moderation] New guest issue #${result?.id ?? 0}: ${title.slice(0, 60)}`,
      `A new guest submission is waiting in the moderation queue (category: ${category}).`
    );
  }
  return jsonResponse({ id: result?.id ?? 0, status: 'pending' }, 0);
}

// ---------------------------------------------------------------------------
// Admin moderation routes
// ---------------------------------------------------------------------------

function parseModerationPath(pathname: string): { id: number | null; action: 'approve' | 'reject' | null } {
  const match = /^\/api\/admin\/moderation(?:\/(\d+)(?:\/(approve|reject))?)?$/.exec(pathname);
  if (!match) return { id: null, action: null };
  return {
    id: match[1] ? Number(match[1]) : null,
    action: (match[2] as 'approve' | 'reject' | undefined) ?? null,
  };
}

export function isModerationRequest(method: string, pathname: string): boolean {
  const { id, action } = parseModerationPath(pathname);
  if (!pathname.startsWith('/api/admin/moderation')) return false;
  if (method === 'GET') return id === null && action === null;
  if (method === 'POST') return id !== null && action !== null;
  return false;
}

async function handleModeration(pathname: string, request: Request, env: Env): Promise<Response> {
  if (!guestEnabled(env)) return disabled();
  const adminToken = await requireAdmin(env, request);
  if (!adminToken) return errorResponse(403, 'FORBIDDEN', 'Repository admin access is required.');
  const db = env.DB as D1Database;
  const { id, action } = parseModerationPath(pathname);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const state = url.searchParams.get('state') ?? 'pending';
    if (state !== 'pending' && state !== 'approved' && state !== 'rejected' && state !== 'all') {
      return errorResponse(400, 'INVALID_PARAMETER', 'state must be pending, approved, rejected, or all.');
    }
    const rows =
      state === 'all'
        ? await db.prepare('SELECT * FROM guest_issues ORDER BY created_at DESC LIMIT 100').all<GuestIssueRow>()
        : await db
            .prepare('SELECT * FROM guest_issues WHERE state = ?1 ORDER BY created_at DESC LIMIT 100')
            .bind(state)
            .all<GuestIssueRow>();
    return jsonResponse({ items: (rows.results ?? []).map(adminRow), state }, 0);
  }

  // POST approve / reject
  if (id === null || action === null) return errorResponse(404, 'NOT_FOUND', 'API endpoint not found.');
  const row = await db.prepare('SELECT * FROM guest_issues WHERE id = ?1').bind(id).first<GuestIssueRow>();
  if (!row) return errorResponse(404, 'NOT_FOUND', 'Submission not found.');
  if (row.state !== 'pending') return errorResponse(409, 'ALREADY_REVIEWED', 'This submission was already reviewed.');

  if (action === 'reject') {
    await db.prepare("UPDATE guest_issues SET state = 'rejected' WHERE id = ?1").bind(id).run();
    logEvent('debug', 'guest_issue_rejected', { id });
    void sendEmail(env, row.email, 'Update on your AnkWorks issue submission', 'Thanks for your submission. After review it was not published.');
    return jsonResponse({ ...publicRow(row), state: 'rejected' }, 0);
  }

  // Approve: create the real GitHub issue with the ADMIN's user token.
  const issueBody = `${row.body}\n\n---\n*Submitted by ${row.name} (guest).*`;
  const response = await fetch(`https://api.github.com/repos/${ORG_NAME}/website/issues`, {
    method: 'POST',
    redirect: 'manual',
    headers: apiHeaders(adminToken),
    body: JSON.stringify({ title: `[guest] ${row.title}`.slice(0, TITLE_MAX), body: issueBody, labels: ['guest', row.category] }),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    logEvent('warn', 'guest_issue_approve_failed', { id, status: response.status });
    return errorResponse(502, 'GITHUB_UNAVAILABLE', 'Could not create the GitHub issue.');
  }
  const issueNumber = (data as { number?: number } | null)?.number ?? 0;
  await db.prepare("UPDATE guest_issues SET state = 'approved', issue_number = ?2 WHERE id = ?1").bind(id, issueNumber).run();
  logEvent('debug', 'guest_issue_approved', { id, issueNumber });
  void sendEmail(env, row.email, 'Your AnkWorks issue was published', `Your submission is now issue #${issueNumber} on ankworks/website.`);
  return jsonResponse({ ...publicRow(row), state: 'approved', issue_number: issueNumber }, 0);
}

async function handleGuestConfig(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET') {
    const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }
  return jsonResponse(
    { enabled: guestEnabled(env), siteKey: env.TURNSTILE_SITE_KEY ?? null },
    0
  );
}

export async function handleGuestRoute(pathname: string, request: Request, env: Env): Promise<Response> {
  if (pathname === '/api/guest/issues') return handleGuestSubmit(request, env);
  if (pathname === '/api/guest/config') return handleGuestConfig(request, env);
  return handleModeration(pathname, request, env);
}
