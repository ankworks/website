/**
 * Cloudflare Worker entry point.
 *
 * - /api/*  → GitHub-backed JSON API (this Worker).
 * - everything else → Workers Static Assets via the ASSETS binding
 *   (SPA fallback to index.html is handled by `assets.not_found_handling`).
 */

import { handleApiRequest } from './api';
import type { Env } from './env';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
