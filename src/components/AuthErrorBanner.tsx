/**
 * Sign-in failure banner.
 *
 * `GET /api/auth/login` and `/api/auth/callback` report failures by redirecting
 * back to the app with `?auth_error=CODE`. Without this component those codes
 * died silently: the user landed on the dashboard, still signed out, with no
 * explanation — which is indistinguishable from "the button does nothing".
 *
 * Each code maps to what actually went wrong and, where the cause is a
 * deployment setting, what an operator has to change. The message is rendered
 * once and the parameter is removed from the URL so a refresh does not resurrect
 * a stale error.
 */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface Explanation {
  title: string;
  body: string;
}

const EXPLANATIONS: Record<string, Explanation> = {
  OAUTH_STATE_MISMATCH: {
    title: 'Sign-in could not be verified',
    body:
      'The OAuth state cookie did not match, so the callback was refused (this is the CSRF guard). It usually means the sign-in tab sat open for more than 10 minutes, or cookies were blocked. Try signing in again.',
  },
  OAUTH_REDIRECT_MISMATCH: {
    title: 'OAuth callback URL is not registered',
    body:
      'GitHub rejected the token exchange because the callback URL does not match the OAuth app. Register this exact URL under GitHub → Settings → Developer settings → OAuth Apps → Authorization callback URL.',
  },
  OAUTH_EXCHANGE_FAILED: {
    title: 'GitHub rejected the sign-in',
    body:
      'The authorization code was refused or already used. Check that the OAuth app client ID/secret match this deployment, then sign in again.',
  },
  OAUTH_USER_FAILED: {
    title: 'GitHub profile could not be loaded',
    body: 'The token was issued but the GitHub API did not return a user profile. Try again in a moment.',
  },
};

/** Fallback for codes added later: never show a raw, unexplained failure. */
function explain(code: string): Explanation {
  return (
    EXPLANATIONS[code] ?? {
      title: 'Sign-in failed',
      body: `The authentication service reported "${code}". Sign in again; if it keeps happening, the deployment's OAuth settings need attention.`,
    }
  );
}

export default function AuthErrorBanner() {
  const location = useLocation();
  const navigate = useNavigate();
  const [code, setCode] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const next = params.get('auth_error');
    // The banner is sticky for this page view: once a failure has been shown it
    // stays until dismissed, otherwise removing the parameter (immediately
    // below) would clear it in the same tick.
    if (!next) return;
    setCode(next);
    setDismissed(false);
    // Drop the parameter so the banner does not survive a reload or a share.
    params.delete('auth_error');
    const search = params.toString();
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
  }, [location.search, location.pathname, location.hash, navigate]);

  if (!code || dismissed) return null;
  const explanation = explain(code);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-6">
      <div
        role="alert"
        data-testid="auth-error"
        className="flex flex-col gap-2 rounded-md border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-text sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="min-w-0">
          <p className="font-medium">{explanation.title}</p>
          <p className="mt-1 leading-6 text-text/80">{explanation.body}</p>
          <p className="mt-1 font-mono text-xs text-muted">code: {code}</p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 self-start rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-text hover:bg-elevated focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
