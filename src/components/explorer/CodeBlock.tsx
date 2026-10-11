/**
 * A Markdown code fence with GitHub-like chrome: a language label, a copy
 * button, and a line-wrap toggle.
 *
 * The content is rendered as React elements (never `innerHTML`) and comes from
 * the syntax highlighter, which only emits `<span>` elements — repository code
 * is never executed, and nothing here can run it.
 */

import { useState, type ReactNode } from 'react';
import { useHighlightedLines, renderHast, textLines } from './HighlightedCode';
import { grammarForFenceTag, languageLabel } from '../../shared/languages';
import { CopyButton } from './ui';
import { CopyIcon, WrapIcon } from './icons';

export interface CodeBlockProps {
  code: string;
  /** Language from the fence info string, when present. */
  language?: string | null;
  /** Fallback content when the caller already produced highlighted nodes. */
  children?: ReactNode;
  /** Render the plain chrome (no copy/wrap) for small or inline contexts. */
  compact?: boolean;
}

export default function CodeBlock({ code, language, compact = false }: CodeBlockProps) {
  const [wrapped, setWrapped] = useState(false);
  const highlighted = useHighlightedLines(code, language ? grammarForFenceTag(language) : null);
  const rows = highlighted ?? textLines(code);
  const label = language ? languageLabel(language) : null;

  return (
    <figure className="markdown-code-block my-4 overflow-hidden rounded-md border border-border bg-background">
      {(label || !compact) && (
        <figcaption className="flex items-center justify-between gap-2 border-b border-border bg-elevated/60 px-3 py-1.5">
          <span className="font-mono text-[11px] uppercase tracking-wide text-muted">{label ?? 'text'}</span>
          {!compact && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setWrapped((value) => !value)}
                aria-pressed={wrapped}
                className="btn-secondary-sm !px-2 !py-1"
                data-testid="code-wrap-toggle"
              >
                <WrapIcon size={12} />
                <span className="sr-only">{wrapped ? 'Disable line wrapping' : 'Enable line wrapping'}</span>
              </button>
              <CopyButton
                text={code}
                label="Copy code to clipboard"
                idleLabel=""
                className="!px-2 !py-1"
                icon={<CopyIcon size={12} />}
              />
            </span>
          )}
        </figcaption>
      )}
      <pre
        className="markdown-pre m-0 overflow-x-auto border-0 bg-transparent p-4 font-mono text-[13px] leading-6"
        data-wrap={wrapped ? 'on' : 'off'}
        data-language={language ?? undefined}
        data-testid="markdown-code-block"
      >
        <code className={language ? `language-${language} block` : 'block'}>
          {rows.map((nodes, index) => (
            <Row key={index} nodes={nodes} wrapped={wrapped} />
          ))}
        </code>
      </pre>
    </figure>
  );
}

function Row({ nodes, wrapped }: { nodes: Parameters<typeof renderHast>[0]; wrapped: boolean }) {
  return (
    <>
      {renderHast(nodes)}
      {wrapped ? ' ' : '\n'}
    </>
  );
}
