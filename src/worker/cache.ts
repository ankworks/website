/**
 * Edge caching for successful GitHub-backed responses via the Workers Cache API.
 *
 * Cache keys are built from validated, canonical parameters only, so arbitrary
 * query strings cannot grow the cache. Errors are never stored.
 */

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
 * Return a cached response when present; otherwise run `produce`, store a copy
 * of successful responses, and return the fresh response. Errors thrown by
 * `produce` propagate to the caller unchanged.
 */
export async function serveCached(
  key: Request,
  ctx: ExecutionContext | undefined,
  produce: () => Promise<Response>
): Promise<Response> {
  const cache = typeof caches !== 'undefined' ? caches.default : undefined;

  if (cache) {
    try {
      const cached = await cache.match(key);
      if (cached) return withCacheHeader(cached, 'HIT');
    } catch (error) {
      // A cache failure must not break the endpoint; fall through to a fresh fetch.
      // eslint-disable-next-line no-console
      console.error('Cache read failed', error);
    }
  }

  const response = await produce();
  if (response.ok && cache) {
    const store = cache.put(key, response.clone()).catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('Cache write failed', error);
    });
    if (ctx) {
      ctx.waitUntil(store);
    } else {
      await store;
    }
  }
  return withCacheHeader(response, 'MISS');
}
