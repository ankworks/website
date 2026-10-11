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
  /** D1 database binding for guest issue moderation (Milestone E). */
  DB?: D1Database;
  /** Cloudflare Turnstile secret key for guest submissions. */
  TURNSTILE_SECRET_KEY?: string;
  /** Public Turnstile site key rendered in the guest form. */
  TURNSTILE_SITE_KEY?: string;
  /** Resend API key for moderation outcome emails (optional). */
  RESEND_API_KEY?: string;
  /** Inbox that receives moderation notifications (optional). */
  MODERATION_NOTIFY_EMAIL?: string;
  /**
   * V3-E: comma-separated GitHub logins explicitly authorized as Forge
   * administrators. When set it takes precedence over the D1 `forge_admins`
   * table. Membership is still verified separately — this never grants it.
   */
  FORGE_ADMIN_LOGINS?: string;
  /**
   * V3-E: R2 bucket for admin-uploaded banner images. Optional; when it is
   * missing, banner images must be supplied as https URLs instead.
   */
  BANNER_IMAGES?: R2Bucket;
  /**
   * Repository names Forge must not serve about itself (comma separated).
   *
   * Used to keep the Forge implementation repository out of Forge's own
   * listings, search, activity, and every scoped API route. Deployment
   * configuration rather than a hardcoded constant. Hiding a repository here
   * does NOT make it private on GitHub.
   */
  FORGE_SELF_REPO?: string;
}
