/**
 * Operations hardening (Milestone F): request IDs, in-isolate metrics,
 * and a health endpoint that reveals nothing sensitive.
 */

import { errorResponse, jsonResponse } from './github-client';
import { logEvent } from './logging';

const startedAt = Date.now();

/** Per-isolate counters (reset on cold start; good enough for smoke metrics). */
const metrics = {
  apiRequests: 0,
  apiErrors: 0,
  authLogins: 0,
  writes: 0,
};

export function bumpMetric(key: keyof typeof metrics, by = 1): void {
  metrics[key] += by;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

/** GET /api/health — liveness + coarse counters. No secrets, no user data. */
export function handleHealth(request: Request): Response {
  if (request.method !== 'GET') {
    const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }
  return jsonResponse(
    {
      status: 'ok',
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
      metrics: { ...metrics },
    },
    0
  );
}

/** Record request completion for metrics/logging. */
export function trackApiOutcome(response: Response, requestId: string): void {
  bumpMetric('apiRequests');
  if (!response.ok && response.status >= 500) bumpMetric('apiErrors');
  logEvent('debug', 'api_metrics', { requestId, status: response.status });
}
