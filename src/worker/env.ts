/**
 * Bindings available to the Worker. Declared in wrangler.jsonc (ASSETS) and
 * provided as Worker secrets (GITHUB_TOKEN, optional).
 */
export interface Env {
  /** Workers Static Assets binding (configured via `assets.binding`). */
  ASSETS: Fetcher;
  /** Optional GitHub token, stored with `wrangler secret put GITHUB_TOKEN`. Never sent to the browser. */
  GITHUB_TOKEN?: string;
  /** GitHub App OAuth client id (`wrangler secret put GITHUB_APP_CLIENT_ID`). Enables sign-in. */
  GITHUB_APP_CLIENT_ID?: string;
  /** GitHub App OAuth client secret. Server-side only; never echoed back. */
  GITHUB_APP_CLIENT_SECRET?: string;
  /** 32+ character secret used to AES-GCM encrypt session cookies. */
  SESSION_ENCRYPTION_KEY?: string;
  /** GitHub App id (numeric). Required from Milestone C for app-actor writes. */
  GITHUB_APP_ID?: string;
  /** GitHub App PEM private key. Server-side only; never used for user writes. */
  GITHUB_APP_PRIVATE_KEY?: string;
}
