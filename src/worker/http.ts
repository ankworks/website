/**
 * Shared HTTP helpers for authenticated Worker routes (V3-B / V3-E).
 *
 * Two guarantees matter here:
 *
 * 1. CSRF: every state-changing request must carry an `Origin` header that
 *    matches its own host. Browsers send `Origin` on all POST/PATCH/PUT/DELETE
 *    requests, so a cross-site form or fetch cannot replay a session cookie.
 *    (Session cookies are `SameSite=Lax` already; this is defence in depth and
 *    it also protects non-browser clients from accidental cross-origin writes.)
 * 2. Cache isolation: any response derived from a session, a membership check,
 *    or admin data is emitted with `Cache-Control: private, no-store` and is
 *    never offered to the shared Cloudflare cache. Authenticated requests must
 *    not be able to poison a public cache entry, and private data must never
 *    land in one.
 */

import { errorResponse } from './github-client';

/** Response headers that keep a response out of every shared cache. */
export const PRIVATE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  Vary: 'Cookie, Origin',
};

export function privateJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...PRIVATE_HEADERS },
  });
}

/**
 * Reject cross-origin state changes.
 *
 * `Origin` is required for mutating methods. A missing `Origin` on a POST is
 * treated as a failure rather than a pass: a legacy form post is exactly the
 * attack this defends against.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    return originUrl.protocol === requestUrl.protocol && originUrl.host === requestUrl.host;
  } catch {
    return false;
  }
}

/** Length-bounded JSON object body; null for anything malformed or too large. */
export async function readJsonBody(request: Request, maxBytes = 100_000): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length > maxBytes) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function methodNotAllowed(allow: string): Response {
  const response = errorResponse(405, 'METHOD_NOT_ALLOWED', `Only ${allow} is supported.`);
  response.headers.set('Allow', allow);
  return response;
}
