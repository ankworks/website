/**
 * Guest issue submission form + admin moderation queue (Milestone E).
 *
 * - The form verifies the visitor with a Cloudflare Turnstile widget before
 *   posting; submissions land in D1 as PENDING rows (emails stay in D1 only).
 * - The moderation panel appears only for repository admins and drives the
 *   approve (publish to GitHub) / reject flows.
 * - When the D1 binding or Turnstile secret is missing the form explains that
 *   submissions are disabled — it never pretends to accept them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { ExplorerApiError } from '../../api/explorer';
import { CommitIcon } from '../explorer/icons';
import { Panel } from '../explorer/ui';

const CATEGORIES = [
  { value: 'bug', label: 'Bug report' },
  { value: 'feature', label: 'Feature request' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
];

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

async function guestFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
  });
}

function TurnstileWidget({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return undefined;

    const renderWidget = () => {
      if (cancelled || !window.turnstile || !containerRef.current || widgetRef.current) return;
      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(''),
      });
    };

    if (window.turnstile) {
      renderWidget();
    } else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = renderWidget;
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
      widgetRef.current = null;
    };
  }, [siteKey, onToken]);

  return (
    <div>
      <div ref={containerRef} data-testid="turnstile-widget" />
      <noscript>JavaScript is required to complete the Turnstile challenge.</noscript>
    </div>
  );
}

export function GuestIssueForm() {
  const [config, setConfig] = useState<{ enabled: boolean; siteKey: string | null } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    guestFetch('/api/guest/config')
      .then((response) => response.json() as Promise<{ enabled: boolean; siteKey: string | null }>)
      .then((data) => {
        if (!cancelled) setConfig(data);
      })
      .catch(() => {
        if (!cancelled) setConfig({ enabled: false, siteKey: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onToken = useCallback((value: string) => setToken(value), []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const response = await guestFetch('/api/guest/issues', {
        method: 'POST',
        body: JSON.stringify({ name, email, category, title, body, website: honeypot, turnstileToken: token }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new ExplorerApiError(payload?.message ?? 'Submission failed.', response.status, 'SUBMISSION_FAILED');
      }
      setDone('Thank you! Your submission is queued for review by a maintainer.');
      setName('');
      setEmail('');
      setTitle('');
      setBody('');
      setToken('');
    } catch (err) {
      setError(err instanceof ExplorerApiError ? err.message : 'Submission failed unexpectedly.');
    } finally {
      setBusy(false);
    }
  };

  if (!config) {
    return <Panel aria-label="Guest issue form" className="p-4"><p className="text-sm text-muted">Loading the submission form…</p></Panel>;
  }
  if (!config.enabled) {
    return (
      <Panel aria-label="Guest issue form" className="p-4">
        <p className="text-sm font-medium text-text">Guest submissions are disabled</p>
        <p className="mt-1 text-xs leading-5 text-muted">
          This deployment has not enabled guest issue submission (it needs the D1 binding and the Turnstile secret). Sign
          in with GitHub to open issues directly.
        </p>
      </Panel>
    );
  }

  return (
    <Panel aria-label="Guest issue form" className="p-4 sm:p-6">
      <h2 className="text-base font-semibold text-text">Submit an issue without an account</h2>
      <p className="mt-1 text-xs leading-5 text-muted">
        Your submission is reviewed by a maintainer before it appears publicly. Your email is stored privately and is
        never published.
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-muted">
            Name
            <input
              type="text"
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            />
          </label>
          <label className="block text-xs text-muted">
            Email (private)
            <input
              type="email"
              required
              maxLength={200}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            />
          </label>
        </div>
        <label className="block text-xs text-muted">
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text"
          >
            {CATEGORIES.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-muted">
          Title
          <input
            type="text"
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          />
        </label>
        <label className="block text-xs text-muted">
          Description
          <textarea
            required
            maxLength={5000}
            rows={5}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="mt-1 w-full resize-y rounded-md border border-border bg-surface p-2 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          />
        </label>
        {/* Honeypot field: hidden from real users, bots fill it. */}
        <label aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
          Website
          <input type="text" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
        </label>
        {config.siteKey ? (
          <TurnstileWidget siteKey={config.siteKey} onToken={onToken} />
        ) : (
          <p className="text-xs text-muted">Turnstile is not configured on this deployment.</p>
        )}
        {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
        {done ? <p className="text-xs text-primary">{done}</p> : null}
        <button
          type="submit"
          disabled={busy || (Boolean(config.siteKey) && token === '')}
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary enabled:hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
        >
          <CommitIcon size={15} />
          {busy ? 'Submitting…' : 'Submit for review'}
        </button>
      </form>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

interface ModerationRow {
  id: number;
  created_at: string;
  name: string;
  email: string;
  category: string;
  title: string;
  body: string;
  state: string;
  issue_number: number | null;
}

export function AdminModerationPanel() {
  const { status } = useAuth();
  const [rows, setRows] = useState<ModerationRow[] | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const response = await guestFetch('/api/admin/moderation?state=pending');
      if (response.status === 403) {
        setVisible(false);
        return;
      }
      if (!response.ok) throw new ExplorerApiError('Could not load the moderation queue.', response.status, 'MODERATION_FAILED');
      const data = (await response.json()) as { items: ModerationRow[] };
      setRows(data.items);
      setVisible(true);
    } catch {
      setVisible(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') void reload();
  }, [status, reload]);

  if (!visible || rows === null) return null;

  const act = async (id: number, action: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      const response = await guestFetch(`/api/admin/moderation/${id}/${action}`, { method: 'POST', body: '{}' });
      if (!response.ok) throw new ExplorerApiError(`Could not ${action} the submission.`, response.status, 'MODERATION_FAILED');
      await reload();
    } catch (err) {
      setError(err instanceof ExplorerApiError ? err.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel aria-label="Moderation queue" className="p-4 sm:p-6">
      <h2 className="text-base font-semibold text-text">Moderation queue</h2>
      <p className="mt-1 text-xs leading-5 text-muted">
        Approving publishes a GitHub issue without the guest&apos;s email. Emails are visible only here.
      </p>
      {error ? <p role="alert" className="mt-2 text-xs text-red-400">{error}</p> : null}
      {rows.length === 0 ? (
        <p className="mt-3 text-sm italic text-muted">No pending submissions.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-md border border-border p-3">
              <p className="text-sm font-medium text-text">
                #{row.id} · {row.title}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {row.category} · by {row.name} · <span className="font-mono">{row.email}</span> · {row.created_at}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-xs text-text">{row.body}</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(row.id, 'approve')}
                  className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary enabled:hover:bg-primary/20 disabled:opacity-70"
                >
                  Approve &amp; publish
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act(row.id, 'reject')}
                  className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-text hover:bg-elevated disabled:opacity-70"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
