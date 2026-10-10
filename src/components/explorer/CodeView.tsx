import { useMemo } from 'react';
import { EXPLORER_LIMITS } from '../../shared/limits';
import { renderHast, textLines, useHighlightedLines } from './HighlightedCode';

interface CodeViewProps {
  content: string;
  /** highlight.js grammar id, or null for plain text. */
  grammar: string | null;
  fileName: string;
}

/**
 * Read-only source viewer with line numbers. Text is always rendered as React
 * text nodes; highlighting produces <span> elements only, never HTML strings.
 * Long lines scroll horizontally instead of wrapping.
 */
export default function CodeView({ content, grammar, fileName }: CodeViewProps) {
  const enabledGrammar = content.length <= EXPLORER_LIMITS.HIGHLIGHT_MAX_BYTES ? grammar : null;
  const highlighted = useHighlightedLines(content, enabledGrammar);
  const rows = useMemo(() => highlighted ?? textLines(content), [highlighted, content]);

  return (
    <div
      role="region"
      aria-label={`Source of ${fileName}`}
      tabIndex={0}
      className="max-h-[80vh] overflow-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <table className="min-w-full border-collapse font-mono text-[13px] leading-6">
        <tbody>
          {rows.map((nodes, index) => {
            const line = index + 1;
            return (
              <tr key={line} id={`L${line}`} className="code-line hover:bg-elevated/50">
                <td className="sticky left-0 w-1 select-none bg-surface px-3 text-right align-top text-muted/70">
                  <a href={`#L${line}`} className="hover:text-primary">
                    {line}
                  </a>
                </td>
                <td className="whitespace-pre px-4 align-top text-text">
                  {nodes.length > 0 ? renderHast(nodes) : ' '}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

