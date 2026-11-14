import { useEffect, useRef, useState } from 'react';

/**
 * Scrambled-text reveal for headings.
 *
 * The label settles into place from a wash of random glyphs — the classic
 * "decode" effect — and re-scrambles every time the pointer enters it. Used on
 * page titles so navigating feels alive without moving layout: the element
 * always renders the final text, sized by a hidden copy, so the block never
 * jumps and screen readers / search engines see the real string.
 *
 * Accessibility and CSP:
 * - The effect is skipped entirely for `prefers-reduced-motion: reduce`.
 * - The visible glyph wash is `aria-hidden`; the real text stays available to
 *   assistive tech through a visually hidden span.
 * - Triggered by pointer events only (hover / focus), never on scroll, so it
 *   costs nothing while a page sits idle.
 */

/** Glyphs used while scrambling. No whitespace, so words keep their shape. */
const GLYPHS = '!#$%&*+-/<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function scrambleFrame(text: string, progress: number): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === ' ') {
      out += ' ';
      continue;
    }
    // Characters settle left-to-right; the tail keeps churning until the end.
    if (index < progress) {
      out += character;
    } else {
      out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    }
  }
  return out;
}

export interface ScrambleTextProps {
  /** Final text. Also what assistive tech and tests read. */
  text: string;
  className?: string;
  /** Element to render. Headings by default; the component is presentation only. */
  as?: 'span' | 'h1' | 'h2';
  /** Re-scramble when the pointer enters / the element is focused. Default true. */
  replayOnHover?: boolean;
}

export default function ScrambleText({ text, className = '', as = 'span', replayOnHover = true }: ScrambleTextProps) {
  const [shown, setShown] = useState(text);
  const frame = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  // Re-run when the label changes (route change reusing the same heading node).
  useEffect(() => {
    setShown(text);
  }, [text]);

  const run = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(text);
      return;
    }
    window.clearTimeout(timer.current);
    frame.current = 0;
    const total = text.length;
    const tick = () => {
      if (!mounted.current) return;
      frame.current += 1;
      // Settle a few characters per tick, all of them within ~30 ticks.
      const progress = Math.ceil((frame.current / 30) * total);
      setShown(scrambleFrame(text, progress));
      if (progress < total) {
        timer.current = window.setTimeout(tick, 34);
      } else {
        setShown(text);
      }
    };
    tick();
  };

  const Component = as;
  return (
    <Component
      className={className}
      data-scramble-text=""
      onPointerEnter={replayOnHover ? run : undefined}
      onFocus={replayOnHover ? run : undefined}
    >
      {/*
        Assistive tech and tests read the real label; only the decorative copy
        ever holds scrambled glyphs. The animated copy keeps the label's own
        length, so the heading does not reflow while it settles.
      */}
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="whitespace-pre" data-scramble-output="">
        {shown}
      </span>
    </Component>
  );
}
