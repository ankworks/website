import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { HastNode } from '../../lib/hast-lines';
import { plainLines } from '../../lib/hast-lines';

/**
 * Lazily load the highlighter and return per-line nodes. Returns null while the
 * highlighter loads or when no grammar applies; callers fall back to plain text.
 */
export function useHighlightedLines(code: string, grammar: string | null): HastNode[][] | null {
  const [lines, setLines] = useState<{ code: string; grammar: string; value: HastNode[][] | null } | null>(null);

  useEffect(() => {
    if (!grammar) return undefined;
    let cancelled = false;
    import('../../lib/highlighter')
      .then((module) => {
        if (!cancelled) setLines({ code, grammar, value: module.highlightLines(code, grammar) });
      })
      .catch(() => {
        if (!cancelled) setLines({ code, grammar, value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [code, grammar]);

  if (!grammar || !lines || lines.code !== code || lines.grammar !== grammar) return null;
  return lines.value;
}

/** Convert HAST nodes to React elements. Only <span> elements are emitted; text is escaped by React. */
export function renderHast(nodes: HastNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === 'text') return <Fragment key={index}>{node.value}</Fragment>;
    const children = renderHast(node.children);
    if (node.tagName !== 'span') return <Fragment key={index}>{children}</Fragment>;
    const className = node.properties.className?.join(' ');
    return (
      <span key={index} className={className}>
        {children}
      </span>
    );
  });
}

/** Split text into lines, dropping the empty final line produced by a trailing newline. */
export function textLines(content: string): HastNode[][] {
  const rows = plainLines(content);
  if (content.endsWith('\n') && rows.length > 0) rows.pop();
  return rows;
}

/** Highlighted inline code block for Markdown fences (no line numbers). */
export default function HighlightedCode({ code, grammar, className = '' }: { code: string; grammar: string; className?: string }) {
  const highlighted = useHighlightedLines(code, grammar);
  const rows = highlighted ?? textLines(code);
  // Re-join lines so the block keeps its original newlines.
  return (
    <code className={`${className} block`}>
      {rows.map((nodes, index) => (
        <Fragment key={index}>
          {renderHast(nodes)}
          {index < rows.length - 1 ? '\n' : null}
        </Fragment>
      ))}
    </code>
  );
}
