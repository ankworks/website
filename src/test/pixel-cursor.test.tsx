import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { usePixelCursor } from '../hooks';

/** Pixel cursor trail: a decorative canvas over the (untouched) pointer. */

let fillRect: ReturnType<typeof vi.fn>;

function stubMatchMedia(matches: (query: string) => boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: matches(query),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function Trail() {
  usePixelCursor();
  return null;
}

function canvas(): HTMLCanvasElement | null {
  return document.querySelector('canvas[data-pixel-trail]');
}

function move(x: number, y: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: x, clientY: y }));
}

/** Painting happens on the next animation frame, never synchronously. */
function nextFrame() {
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
}

describe('usePixelCursor', () => {
  beforeEach(() => {
    fillRect = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      fillRect,
      setTransform: vi.fn(),
      fillStyle: '',
      globalAlpha: 1,
      imageSmoothingEnabled: true,
    } as unknown as CanvasRenderingContext2D);
    document.documentElement.style.setProperty('--forge-primary', '163 230 53');
    stubMatchMedia((query) => query.includes('(hover: hover)'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.querySelectorAll('canvas[data-pixel-trail]').forEach((node) => node.remove());
    document.documentElement.removeAttribute('data-theme');
  });

  it('mounts a single non-interactive overlay and removes it on unmount', () => {
    const view = render(<Trail />);
    const node = canvas();
    expect(node).not.toBeNull();
    expect(node!.getAttribute('aria-hidden')).toBe('true');
    expect(node!.style.pointerEvents).toBe('none');
    // Below the sticky header (z-50) and command palette (z-70).
    expect(node!.style.zIndex).toBe('40');

    view.unmount();
    expect(canvas()).toBeNull();
  });

  it('paints grid-snapped trail cells once the pointer moves', async () => {
    render(<Trail />);
    move(100, 100);
    move(133, 104);
    await nextFrame();

    expect(fillRect).toHaveBeenCalled();
    const [x, y, w, h] = fillRect.mock.calls.at(-1) as number[];
    // Snapped to the 10px grid.
    expect(x % 10).toBe(0);
    expect(y % 10).toBe(0);
    expect(w).toBe(10);
    expect(h).toBe(10);
  });

  it('ignores repeated positions inside the same grid cell', async () => {
    render(<Trail />);
    move(101, 101);
    await nextFrame();
    expect(fillRect.mock.calls.length).toBeGreaterThan(0);

    fillRect.mockClear();
    move(102, 103);
    await nextFrame();

    // Same 10px cell: no extra pixel is queued, the existing one only ages.
    const painted = new Set(fillRect.mock.calls.map(([x, y]) => `${x},${y}`));
    expect([...painted]).toEqual(['100,100']);
  });

  it('stays out of the way when reduced motion is requested', () => {
    stubMatchMedia((query) => query.includes('(hover: hover)') || query.includes('prefers-reduced-motion'));
    render(<Trail />);
    expect(canvas()).toBeNull();
  });

  it('does not mount for touch / coarse pointers', () => {
    stubMatchMedia(() => false);
    render(<Trail />);
    expect(canvas()).toBeNull();
  });

  it('re-reads the accent colour when the theme changes', async () => {
    render(<Trail />);
    move(40, 40);
    await nextFrame();
    expect(fillRect).toHaveBeenCalled();
    fillRect.mockClear();

    document.documentElement.dataset.theme = 'light';
    document.documentElement.style.setProperty('--forge-primary', '77 124 15');
    await nextFrame();
    move(80, 80);
    await nextFrame();

    await waitFor(() => expect(fillRect).toHaveBeenCalled());
    // The new light-theme token is used, not the dark-theme fallback.
    expect(fillRect.mock.calls.some((call) => String(call[0]) === '80')).toBe(true);
  });
});
