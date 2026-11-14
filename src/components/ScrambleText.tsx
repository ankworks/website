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

/**
 * Tuning. Long enough to read as "decoding" (one full pass of glyphs on every
 * character, plus a short tail), short enough to not feel like a loading state:
 * 14 frames × 26ms ≈ 360ms.
 */
/** Frame interval in ms. Deliberately >16ms: a 60fps churn is too fast to see. */
const FRAME_MS = 26;
/** Frames used to sweep the reveal from the first character to the last. */
const SETTLE_FRAMES = 11;
/** Extra frames during which the settled tail still flickers. */
const TAIL_FRAMES = 3;

/**
 * One frame of the effect.
 *
 * `progress` is the float frontier (in characters) of the left-to-right reveal.
 * Every character past the frontier is a random glyph — no character is ever
 * left showing its final form before its turn, which is what made a re-used
 * heading look like "only half the word scrambles".
 */
function scrambleFrame(text: string, progress: number, settled: boolean): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === ' ') {
      out += ' ';
      continue;
    }
    out += index < progress ? character : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  }
  return settled ? text : out;
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


  const run = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(text);
      return;
    }
    window.clearTimeout(timer.current);
    frame.current = 0;
    // The frontier moves per character, not per word: a long label takes the
    // same wall-clock time as a short one, so "Pull Requests" is fully garbled
    // at the start rather than already half-settled.
    const total = text.length;
    const lastFrame = SETTLE_FRAMES + TAIL_FRAMES;
    const tick = () => {
      if (!mounted.current) return;
      frame.current += 1;
      const progress = (Math.min(frame.current, SETTLE_FRAMES) / SETTLE_FRAMES) * total;
      const done = frame.current >= lastFrame;
      setShown(scrambleFrame(text, progress, done));
      if (!done) timer.current = window.setTimeout(tick, FRAME_MS);
    };
    tick();
  };

  // Play on every label change — first paint included — so a heading is never
  // just sitting there fully formed until the pointer happens to cross it.
  useEffect(() => {
    run();
    // `run` is intentionally not a dependency: it closes over `text`, which is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

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
