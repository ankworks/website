/**
 * "Go to file" (V3-A): a keyboard-first filter over the repository's file paths.
 *
 * The Worker serves a bounded recursive tree listing per ref and returns at most
 * 50 matches; it never downloads file contents or an archive. When GitHub marks
 * the tree as truncated (very large repositories) the dialog says so rather than
 * implying the index is complete.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { insightsApi } from '../../api/insights';
import { blobPath, fileName } from '../../shared/routes';
import { FileIcon, SearchIcon, XIcon } from './icons';
import { ErrorState, Skeleton } from './ui';

interface FileSearchDialogProps {
  repo: string;
  gitRef: string;
  onClose: () => void;
}

const MIN_QUERY_LENGTH = 1;
const DEBOUNCE_MS = 220;

export default function FileSearchDialog({ repo, gitRef, onClose }: FileSearchDialogProps) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [hits, setHits] = useState<Array<{ path: string; name: string }>>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setDebounced('');
      return undefined;
    }
    const timer = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (debounced.length === 0) {
      setHits([]);
      setStatus('idle');
      return undefined;
    }
    let cancelled = false;
    setStatus('loading');
    insightsApi
      .fileSearch(repo, gitRef, debounced)
      .then((response) => {
        if (cancelled) return;
        setHits(response.hits);
        setTruncated(response.truncated);
        setStatus('ready');
        setActive(0);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, repo, gitRef]);

  const open = (path: string) => {
    onClose();
    navigate(blobPath(repo, gitRef, path));
  };

  const list = useMemo(() => hits, [hits]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[10vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Go to file in ${repo}`}
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-surface shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <SearchIcon size={15} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, list.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter' && list[active]) {
                event.preventDefault();
                open(list[active]?.path ?? '');
              }
            }}
            placeholder="Search file paths…"
            aria-label="Search file paths"
            className="w-full bg-transparent py-3 text-sm text-text placeholder:text-muted focus:outline-none"
          />
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted hover:text-text">
            <XIcon size={15} />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {status === 'idle' && <p className="px-4 py-6 text-sm text-muted">Type at least one character to search.</p>}
          {status === 'loading' && (
            <div className="space-y-2 px-4 py-4">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          )}
          {status === 'error' && (
            <div className="px-4 py-4">
              <ErrorState error={error} compact />
            </div>
          )}
          {status === 'ready' && list.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted">No file paths match “{debounced}”.</p>
          )}
          {status === 'ready' && list.length > 0 && (
            <ul role="listbox" aria-label="Matching files">
              {list.map((hit, index) => (
                <li key={hit.path}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => open(hit.path)}
                    className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                      index === active ? 'bg-elevated text-text' : 'text-muted hover:bg-elevated/60'
                    }`}
                  >
                    <FileIcon size={14} className="shrink-0" />
                    <span className="truncate">{hit.path}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted">{fileName(hit.path)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {truncated && (
          <p className="border-t border-border px-4 py-2 text-xs text-muted">
            This repository is large: results are limited to the first matches in one tree listing and may be incomplete.
          </p>
        )}
      </div>
    </div>
  );
}
