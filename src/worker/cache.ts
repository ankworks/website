/**
 * Edge caching for successful GitHub-backed responses via the Workers Cache API.
 *
 * The cache is a pure optimization: a failure to read from or write to it must
 * never prevent the Worker from serving data. Cache errors are classified as
 * CACHE_ERROR in structured logs (never surfaced to clients) and the request
 * continues without the cache.
 *
 * Cache keys are built from validated, canonical parameters only, so arbitrary
 * query strings cannot grow the cache. Errors are never stored.
 */
import { logEvent } from './logging';

export function cacheKeyFor(origin: string, path: string, params: Record<string, string | number | undefined> = {}): Request {
  const url = new URL(path, origin);
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return new Request(url.toString(), { method: 'GET' });
}

function withCacheHeader(response: Response, value: 'HIT' | 'MISS'): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Cache', value);
  return new Response(response.body, { status: response.status, headers });
}

/**
 * Return the default Cache, or undefined when the Cache API is unavailable or
 * throws (it is available in deployed Workers and in local workerd, but any
 * failure here is non-fatal by design).
 */
function getDefaultCache(): Cache | undefined {
  try {
    return typeof caches !== 'undefined' ? caches.default : undefined;
  } catch (error) {
    logEvent('warn', 'cache_failure', {
      code: 'CACHE_ERROR',
      stage: 'cache_init',
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return undefined;
  }
}

function errorNameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Return a cached response when present; otherwise run `produce`, store a copy
 * of successful responses, and return the fresh response. Errors thrown by
 * `produce` propagate to the caller unchanged.
 */
export async function serveCached(
  key: Request,
  ctx: ExecutionContext | undefined,
  produce: () => Promise<Response>
): Promise<Response> {
  const cache = getDefaultCache();

  if (cache) {
    try {
      const cached = await cache.match(key);
      if (cached) return withCacheHeader(cached, 'HIT');
    } catch (error) {
      // A cache read failure must not break the endpoint; fall through to a fresh fetch.
      logEvent('warn', 'cache_failure', { code: 'CACHE_ERROR', stage: 'cache_read', errorName: errorNameOf(error) });
    }
  }

  const response = await produce();
  if (response.ok && cache) {
    const store = cache.put(key, response.clone()).catch((error: unknown) => {
      // A cache write failure must not affect the client; the response is already final.
      logEvent('warn', 'cache_failure', { code: 'CACHE_ERROR', stage: 'cache_write', errorName: errorNameOf(error) });
    });
    if (ctx) {
      ctx.waitUntil(store);
    } else {
      await store;
    }
  }
  return withCacheHeader(response, 'MISS');
}
