/**
 * Structured diagnostic logging for the Worker.
 *
 * Every line is a single JSON object with a stable `event` name so Cloudflare
 * Observability / Logpush can filter on it:
 *
 *   { "event": "github_api_failure", "stage": "upstream_fetch", "errorName": "TypeError", "durationMs": 12, "upstreamStatus": null }
 *
 * Fields are sanitized before they leave the Worker: keys that look like
 * credentials are dropped and string values are truncated and scrubbed, so a
 * GITHUB_TOKEN, Authorization header value, cookie, or client IP can never be
 * logged even by accident. Log levels:
 * - debug: per-request flow (kept to one compact line per request)
 * - warn:  recoverable failures (cache errors, upstream 4xx/5xx, rejected redirects)
 * - error: unexpected exceptions
 *
 * This module is the only place the Worker writes to the console.
 */
/* eslint-disable no-console */

type LogLevel = 'debug' | 'warn' | 'error';
type LogFields = Record<string, unknown>;

/** Field names that must never reach a log line. */
const FORBIDDEN_KEY =
  /token|authorization|cookie|secret|password|credential|bearer|x-forwarded|remote[-_]?addr|client[-_]?ip|cf[-_]?connecting/i;
const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 3;
const MAX_ARRAY_ITEMS = 20;

/** Scrub anything that looks like a credential out of a string value. */
function scrub(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{6,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,})\b/g, '[REDACTED_TOKEN]')
    .replace(/((?:token|api[_-]?key|secret|password|authorization)(\s*[=:]\s*))\S+/gi, '$1[REDACTED]');
}

function sanitize(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED]';
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return scrub(value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) : value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) continue;
      out[key] = sanitize(item, depth + 1);
    }
    return out;
  }
  return scrub(String(value).slice(0, MAX_STRING_LENGTH));
}

/** Emit one structured log line: { event, ...sanitized fields }. */
export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const payload: Record<string, unknown> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    payload[key] = sanitize(value, 1);
  }
  const line = JSON.stringify(payload);
  if (level === 'debug') console.debug(line);
  else if (level === 'warn') console.warn(line);
  else console.error(line);
}
