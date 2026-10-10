/**
 * Search page and command palette (Milestone F).
 *
 * SearchPage renders org-scoped GitHub search results. CommandPalette gives
 * ⌘K/Ctrl-K quick navigation and search jump. Both are pure UI over the
 * read-only search API.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { searchApi, type SearchItem, type SearchResponse } from '../api/search';
import { blobPath, issuePath, pullRequestPath, repoPath } from '../shared/routes';
import { ExternalLink, Panel } from './explorer/ui';

const TYPE_OPTIONS = [
  { value: 'issues', label: 'Issues & PRs' },
  { value: 'code', label: 'Code' },
  { value: 'repos', label: 'Repositories' },
] as const;

function itemHref(item: SearchItem): string {
  if (item.type === 'repos') {
    const full = String(item.title ?? '');
    return repoPath(full.includes('/') ? full.split('/')[1] : full);
  }
  if (item.type === 'issues') {
    const repo = String(item.repo ?? '').split('/')[1] ?? '';
    const number = Number(item.number ?? 0);
    return item.is_pull ? pullRequestPath(repo, number) : issuePath(repo, number);
  }
  const repo = String(item.repo ?? '').split('/')[1] ?? '';
  return blobPath(repo, 'HEAD', String(item.path ?? ''));
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const type = (searchParams.get('type') ?? 'issues') as 'code' | 'issues' | 'repos';
  const [input, setInput] = useState(query);
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; data?: SearchResponse; message?: string }>({ status: 'idle' });

  useEffect(() => {
    setInput(query);
  }, [query]);

  useEffect(() => {
    if (!query) {
      setState({ status: 'idle' });
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    searchApi
      .search(query, type)
      .then((data) => {
        if (!cancelled) setState({ status: 'done', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: error instanceof Error ? error.message : 'Search failed.' });
      });
    return () => {
      cancelled = true;
    };
  }, [query, type]);

  const submit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const trimmed = input.trim();
      setSearchParams(trimmed ? { q: trimmed, type } : {});
    },
    [input, setSearchParams, type]
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Search</h1>
        <p className="mt-1 text-sm text-muted">Search across AnkWorks repositories.</p>
      </header>
      <form onSubmit={submit} role="search" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Search issues, code, repositories…"
          aria-label="Search query"
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface px-3 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        />
        <select
          value={type}
          onChange={(event) => setSearchParams({ q: query, type: event.target.value })}
          aria-label="Result type"
          className="h-10 rounded-md border border-border bg-surface px-2 text-sm text-text"
        >
          {TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button type="submit" className="h-10 rounded-md border border-primary/40 bg-primary/10 px-4 text-sm font-medium text-primary hover:bg-primary/20">
          Search
        </button>
      </form>

      {state.status === 'loading' ? <p aria-busy="true" className="text-sm text-muted">Searching…</p> : null}
      {state.status === 'error' ? <p role="alert" className="text-sm text-red-400">{state.message}</p> : null}
      {state.status === 'done' && state.data ? (
        <section aria-label="Search results" className="space-y-2">
          <p className="text-xs text-muted">
            {state.data.total_count} result{state.data.total_count === 1 ? '' : 's'} for <span className="font-mono text-text">{state.data.query}</span>
          </p>
          {state.data.items.length === 0 ? (
            <Panel className="p-4"><p className="text-sm italic text-muted">No results found.</p></Panel>
          ) : (
            <ul className="space-y-2">
              {state.data.items.map((item, index) => (
                <li key={index}>
                  <Panel className="p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link to={itemHref(item)} className="text-sm font-medium text-primary hover:underline">
                        {item.title as string}
                      </Link>
                      <ExternalLink href={item.html_url as string}>GitHub</ExternalLink>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">
                      {item.type === 'code' ? `${item.repo as string} · ${item.path as string}` : item.type === 'issues' ? `${item.repo as string} · #${item.number as number} · ${item.state as string}` : (item.description as string)}
                    </p>
                  </Panel>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

const PALETTE_LINKS = [
  { label: 'Dashboard', to: '/' },
  { label: 'Explore', to: '/explore' },
  { label: 'Repositories', to: '/repos' },
  { label: 'Issues', to: '/issues' },
  { label: 'Pull Requests', to: '/pulls' },
  { label: 'About', to: '/about' },
  { label: 'Search', to: '/search' },
];

/** Global ⌘K / Ctrl-K command palette (navigation + search jump). */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const matches = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return PALETTE_LINKS.filter((link) => needle === '' || link.label.toLowerCase().includes(needle));
  }, [term]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Type a command or search…"
          aria-label="Command palette input"
          className="h-12 w-full border-b border-border bg-surface px-4 text-sm text-text focus:outline-none"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const first = matches[0];
              if (term.trim() && (!first || first.label.toLowerCase().includes(term.trim().toLowerCase()) === false)) {
                navigate(`/search?q=${encodeURIComponent(term.trim())}`);
              } else if (first) {
                navigate(first.to);
              }
              setOpen(false);
            }
          }}
        />
        <ul className="max-h-72 overflow-auto p-1.5">
          {matches.map((link) => (
            <li key={link.to}>
              <button
                type="button"
                onClick={() => {
                  navigate(link.to);
                  setOpen(false);
                }}
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-text hover:bg-elevated focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                {link.label}
              </button>
            </li>
          ))}
          {term.trim() ? (
            <li>
              <button
                type="button"
                onClick={() => {
                  navigate(`/search?q=${encodeURIComponent(term.trim())}`);
                  setOpen(false);
                }}
                className="block w-full rounded-md px-3 py-2 text-left text-sm text-primary hover:bg-elevated"
              >
                Search for “{term.trim()}”
              </button>
            </li>
          ) : null}
          {matches.length === 0 && !term.trim() ? (
            <li className="px-3 py-2 text-sm italic text-muted">No commands.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
