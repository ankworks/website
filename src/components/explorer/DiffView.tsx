/**
 * Unified diff renderer (Milestone C diff viewer).
 *
 * Renders the `patch` text of compare results with GitHub-style added/removed
 * rows. Patches that GitHub omits (binary, too large) degrade to a clear note.
 */

import { Fragment } from 'react';
import type { CompareFile, CompareResponse } from '../../types';
import { ExternalLink } from './ui';

interface DiffLine {
  kind: 'hunk' | 'add' | 'del' | 'context' | 'meta';
  text: string;
}

function parsePatch(patch: string | null): DiffLine[] {
  if (!patch) return [];
  const lines: DiffLine[] = [];
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) lines.push({ kind: 'hunk', text: raw });
    else if (raw.startsWith('+')) lines.push({ kind: 'add', text: raw });
    else if (raw.startsWith('-')) lines.push({ kind: 'del', text: raw });
    else if (raw.startsWith('\\')) lines.push({ kind: 'meta', text: raw });
    else lines.push({ kind: 'context', text: raw.startsWith(' ') ? raw.slice(1) : raw });
  }
  return lines;
}

const ROW_CLASS: Record<DiffLine['kind'], string> = {
  hunk: 'bg-elevated/80 text-muted',
  add: 'bg-primary/10 text-text',
  del: 'bg-red-500/10 text-text',
  context: 'text-text',
  meta: 'text-muted italic',
};

function DiffFileCard({ file }: { file: CompareFile }) {
  const lines = parsePatch(file.patch);
  return (
    <section aria-label={`Changes to ${file.filename}`} className="overflow-hidden rounded-md border border-border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
        <span className="truncate font-mono text-xs font-medium text-text">{file.filename}</span>
        <span className="flex items-center gap-2 text-[11px]">
          <span className="rounded-full border border-border px-2 py-0.5 capitalize text-muted">{file.status}</span>
          <span className="font-medium text-primary">+{file.additions}</span>
          <span className="font-medium text-red-400">−{file.deletions}</span>
        </span>
      </header>
      {file.patch ? (
        <div className="overflow-x-auto bg-background">
          <table className="w-full border-collapse font-mono text-[12px] leading-5">
            <tbody>
              {lines.map((line, index) => (
                <tr key={index} className={ROW_CLASS[line.kind]}>
                  <td className="select-none whitespace-pre px-2 text-right align-top text-muted/60" aria-hidden="true">
                    {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : line.kind === 'hunk' ? '@' : ''}
                  </td>
                  <td className="whitespace-pre-wrap break-all px-2 py-px">{line.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-3 py-2 text-xs italic text-muted">
          No textual diff is available for this file (binary or oversized change).
        </p>
      )}
    </section>
  );
}

export default function DiffView({ compare }: { compare: CompareResponse }) {
  return (
    <div className="space-y-3" data-testid="diff-view">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          <span className="font-mono text-text">{compare.base}</span>
          <span aria-hidden="true"> → </span>
          <span className="font-mono text-text">{compare.head}</span>
          <span className="ml-2 rounded-full border border-border px-2 py-0.5 text-[11px] capitalize">{compare.status}</span>
          <span className="ml-2 text-xs">
            {compare.total_commits} commit{compare.total_commits === 1 ? '' : 's'} · {compare.files.length} file{compare.files.length === 1 ? '' : 's'}
          </span>
        </p>
        <ExternalLink href={compare.html_url}>View comparison on GitHub</ExternalLink>
      </div>
      {compare.files.length === 0 ? (
        <p className="text-sm italic text-muted">No file changes in this range.</p>
      ) : (
        compare.files.map((file) => (
          <Fragment key={file.filename}>
            <DiffFileCard file={file} />
          </Fragment>
        ))
      )}
    </div>
  );
}
