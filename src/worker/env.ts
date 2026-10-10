/**
 * Bindings available to the Worker. Declared in wrangler.jsonc (ASSETS) and
 * provided as Worker secrets (GITHUB_TOKEN, optional).
 */
export interface Env {
  /** Workers Static Assets binding (configured via `assets.binding`). */
  ASSETS: Fetcher;
  /** Optional GitHub token, stored with `wrangler secret put GITHUB_TOKEN`. Never sent to the browser. */
  GITHUB_TOKEN?: string;
}
