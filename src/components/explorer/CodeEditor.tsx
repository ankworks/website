/**
 * CSP-safe code editing surface (Milestone C).
 *
 * Production CSP keeps `style-src 'self'`, which rules out Monaco/CodeMirror
 * (both inject runtime <style> elements and inline style attributes). This
 * surface is an accessible textarea with a synchronized line-number gutter —
 * no inline styles, no runtime stylesheets. The component API is deliberately
 * editor-agnostic so Monaco can replace it in a future CSP review.
 */

import { useRef, type ChangeEvent, type UIEvent } from 'react';

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** Accessible name for the editing surface. */
  ariaLabel: string;
  readOnly?: boolean;
  /** Tailwind height class for the editing area. */
  heightClass?: string;
}

export default function CodeEditor({ value, onChange, ariaLabel, readOnly = false, heightClass = 'h-[28rem]' }: CodeEditorProps) {
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const lines = value.split('\n').length;

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop;
  };

  return (
    <div className={`flex overflow-hidden rounded-md border border-border bg-surface ${heightClass}`}>
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="select-none overflow-hidden border-r border-border bg-elevated/40 px-2 py-4 text-right font-mono text-[13px] leading-6 text-muted/70"
      >
        {Array.from({ length: lines }, (_, index) => (
          <div key={index}>{index + 1}</div>
        ))}
      </div>
      <textarea
        value={value}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange?.(event.target.value)}
        onScroll={syncScroll}
        aria-label={ariaLabel}
        readOnly={readOnly}
        spellCheck={false}
        wrap="off"
        className="h-full w-full resize-none bg-surface px-4 py-4 font-mono text-[13px] leading-6 text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      />
    </div>
  );
}
