/**
 * Reactions on an issue, pull request, or comment (V3-C).
 *
 * Rules this component follows:
 * - Counts come from the API and are never computed locally. If the API reports
 *   nothing, the row says reactions are unavailable instead of showing zeroes.
 * - A guest, a non-member, or a viewer whose membership could not be verified
 *   sees the tallies but cannot toggle them; the control explains why.
 * - The server re-authorizes every toggle. Anything disabled here is a courtesy,
 *   not the security boundary.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import { reactionsApi } from '../../api/discussions';
import {
  REACTION_CONTENTS,
  REACTION_LABELS,
  type ReactionContent,
  type ReactionGroup,
  type ReactionSubjectKind,
  type ReactionsResponse,
} from '../../shared/discussions';

export interface ReactionsBarProps {
  repo: string;
  kind: ReactionSubjectKind;
  /** Issue/PR number, or a comment id, depending on the subject kind. */
  target: string;
  /** Initial tallies when the parent already has them; otherwise they are fetched. */
  initial?: ReactionGroup[];
  /** Called after a successful toggle so the parent can refresh its own data. */
  onChanged?: () => void;
}

export default function ReactionsBar({ repo, kind, target, initial, onChanged }: ReactionsBarProps) {
  const { status, isMember, membership } = useAuth();
  const [groups, setGroups] = useState<ReactionGroup[] | null>(initial ?? null);
  const [status_, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReactionContent | null>(null);

  const canWrite = status === 'authenticated' && isMember && membership.status === 'ready';

  // Only fetch when the parent did not provide the tallies.
  useEffect(() => {
    if (initial) {
      setGroups(initial);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    reactionsApi
      .get(repo, kind, target)
      .then((response: ReactionsResponse) => {
        if (!cancelled) {
          setGroups(response.reactions);
          setStatus('idle');
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Reactions could not be loaded.');
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo, kind, target, initial]);

  const toggle = useCallback(
    async (content: ReactionContent) => {
      if (!canWrite || pending) return;
      const current = (groups ?? []).find((group) => group.content === content);
      const viewerHasReacted = current?.viewerHasReacted === true;
      setPending(content);
      setError(null);
      try {
        const next = viewerHasReacted
          ? await reactionsApi.remove(repo, kind, target, content)
          : await reactionsApi.add(repo, kind, target, content);
        setGroups(next.reactions);
        onChanged?.();
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : 'The reaction could not be saved.');
      } finally {
        setPending(null);
      }
    },
    [canWrite, groups, kind, onChanged, pending, repo, target]
  );

  if (status_ === 'loading' && groups === null) {
    return <div className="text-xs text-muted" data-testid="reactions-loading">Loading reactions…</div>;
  }
  if (status_ === 'error') {
    return (
      <div className="text-xs text-muted" data-testid="reactions-unavailable">
        Reactions unavailable{error ? ` — ${error}` : ''}
      </div>
    );
  }
  if (!groups || groups.length === 0) {
    return (
      <div className="text-xs text-muted" data-testid="reactions-empty">
        No reactions yet{canWrite ? '' : ' — sign in as an AnkWorks member to react'}
      </div>
    );
  }

  const byContent = new Map(groups.map((group) => [group.content, group]));

  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="reactions-bar">
      {REACTION_CONTENTS.map((content) => {
        const group = byContent.get(content);
        if (!group) return null;
        const meta = REACTION_LABELS[content];
        const active = group.viewerHasReacted;
        return (
          <button
            key={content}
            type="button"
            onClick={() => void toggle(content)}
            disabled={!canWrite || pending !== null}
            aria-pressed={active}
            title={
              canWrite
                ? `${active ? 'Remove' : 'Add'} ${meta.label.toLowerCase()}`
                : 'Only verified AnkWorks members can react'
            }
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${
              active ? 'border-accent/60 bg-accent/10 text-text' : 'border-border text-muted hover:border-accent/40'
            } disabled:cursor-not-allowed disabled:opacity-60`}
            data-testid={`reaction-${content.toLowerCase()}`}
          >
            <span aria-hidden="true">{meta.emoji}</span>
            <span>{group.count}</span>
            <span className="sr-only">{meta.label}</span>
          </button>
        );
      })}
      {!canWrite && (
        <span className="ml-1 text-xs text-muted" data-testid="reactions-readonly">
          Members only
        </span>
      )}
      {error && (
        <span className="ml-1 text-xs text-amber-400" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
