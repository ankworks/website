/**
 * Cloudflare Worker Entry Point
 * Handles both API routes and static file serving
 */

import { handleApiRequest } from './api';

// Static assets manifest type
interface AssetManifest {
  version: string;
  assets: Record<string, { file: string; integrity?: string }>;
}

// Load static assets manifest if available
let manifest: AssetManifest | null = null;

try {
  // In Cloudflare Workers, assets are available via import
  // @ts-ignore - This is handled by Wrangler's asset binding
  manifest = require('./__static__/manifest.json');
} catch {
  // No manifest, we'll try to serve files directly
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // API routes - handle /api/* requests
    if (path.startsWith('/api/')) {
      return handleApiRequest(request);
    }

    // Try to serve static files
    try {
      // For Cloudflare Workers with static assets
      // @ts-ignore - Wrangler injects __STATIC_CONTENT_MANIFEST
      if (typeof __STATIC_CONTENT_MANIFEST !== 'undefined') {
        const staticPath = path.replace(/^\//, '');
        
        // Try to get the asset from the manifest
        // @ts-ignore
        const asset = __STATIC_CONTENT_MANIFEST[staticPath] || 
                     // @ts-ignore
                     __STATIC_CONTENT_MANIFEST[staticPath + '.html'];
        
        if (asset) {
          // @ts-ignore
          return new Response(asset.body, {
            headers: {
              'Content-Type': asset.contentType || getContentType(staticPath),
              'Cache-Control': asset.cacheControl || 'public, max-age=31536000, immutable',
            },
          });
        }
      }

      // Fallback: try to fetch the file from the origin
      // This works when running in dev mode or when files are deployed
      const fileResponse = await fetch(request);
      
      // If we get a 404 from the origin, try index.html for SPA routing
      if (fileResponse.status === 404) {
        const indexResponse = await fetch(new Request(url.origin + '/index.html', request));
        if (indexResponse.ok) {
          return indexResponse;
        }
      }
      
      return fileResponse;
    } catch {
      // Final fallback: return index.html for SPA routing
      try {
        return await fetch(new Request(url.origin + '/index.html', request));
      } catch {
        return new Response('Not Found', { status: 404 });
      }
    }
  },
};

/**
 * Get content type based on file extension
 */
function getContentType(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  
  const types: Record<string, string> = {
    html: 'text/html;charset=UTF-8',
    css: 'text/css;charset=UTF-8',
    js: 'application/javascript;charset=UTF-8',
    json: 'application/json;charset=UTF-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    txt: 'text/plain;charset=UTF-8',
    xml: 'application/xml;charset=UTF-8',
    webp: 'image/webp',
    avif: 'image/avif',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    eot: 'application/vnd.ms-fontobject',
  };
  
  return types[extension || ''] || 'application/octet-stream';
}
