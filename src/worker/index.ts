/**
 * Cloudflare Worker with Static Assets
 * Handles API routes and serves static files
 */

import { handleApiRequest } from './api';

// @ts-ignore - Wrangler injects __STATIC_CONTENT for assets
const ASSETS = __STATIC_CONTENT;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // API routes - handle /api/* requests
    if (path.startsWith('/api/')) {
      return handleApiRequest(request);
    }

    // Serve static assets
    try {
      // @ts-ignore
      return await ASSETS.fetch(request);
    } catch {
      // Fallback to index.html for SPA routing
      try {
        // @ts-ignore
        return await ASSETS.fetch(new Request(url.origin + '/index.html', request));
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    }
  }
};
