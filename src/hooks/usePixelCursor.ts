import { useEffect } from 'react';

/**
 * Pixel cursor trail.
 *
 * A chunky, low-resolution trail of squares that follows the pointer and fades
 * out — a CRT/retro flourish over the normal cursor. The real cursor is left
 * untouched so links, text selection and the accessibility focus ring keep
 * working exactly as before.
 *
 * Design notes:
 * - Drawn on a coarse grid (CELL px). Pointer positions snap to that grid, so
 *   the trail is genuinely pixelated rather than a smooth blur.
 * - Palette comes from the `--forge-primary` theme token, so the trail follows
 *   the lime/dark-green accent and adapts to light mode automatically.
 * - Rendered once per animation frame (not per pointer event), and stops
 *   entirely while the pointer is idle or the tab is hidden.
 * - Skipped for `prefers-reduced-motion` and for coarse pointers (touch), where
 *   there is no hover cursor to decorate and the pixels would just be noise.
 * - CSP-safe: one canvas size is set through the style attribute and no
 *   runtime stylesheet or inline <style> element is created.
 */

/** Grid size of a trail pixel, in CSS pixels. */
const CELL = 10;
/** Lifetime of a single trail cell, in frames. */
const LIFE = 26;
type Pixel = {
  x: number;
  y: number;
  life: number;
};

function readPrimaryRgb(): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--forge-primary').trim();
  const parts = raw.split(/[\s,]+/).map((part) => Number.parseInt(part, 10));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    return [parts[0], parts[1], parts[2]];
  }
  // Fall back to the dark-theme lime when the token is unavailable.
  return [163, 230, 53];
}

function resetContext(context: CanvasRenderingContext2D) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
}

export function usePixelCursor(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof document === 'undefined') return;
    if (typeof HTMLCanvasElement === 'undefined') return;

    const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
    if (!finePointer) return;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (reducedMotion?.matches) return;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.dataset.pixelTrail = '';
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    // Below the sticky header (z-50) and the command palette (z-70), above page content.
    canvas.style.zIndex = '40';
    canvas.style.pointerEvents = 'none';

    const context = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!context) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let primary = readPrimaryRgb();
    let pixels: Pixel[] = [];
    let raf = 0;
    let running = false;
    // Pointer position in grid units, so the trail follows the shape of the path.
    let lastCellX: number | null = null;
    let lastCellY: number | null = null;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      resetContext(context);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.imageSmoothingEnabled = false;
    };

    const render = () => {
      context.clearRect(0, 0, width, height);
      const [r, g, b] = primary;
      for (const pixel of pixels) {
        const t = pixel.life / LIFE;
        context.fillStyle = `rgb(${r} ${g} ${b} / ${(t * 0.55).toFixed(3)})`;
        context.fillRect(pixel.x, pixel.y, CELL, CELL);
      }
    };

    const step = () => {
      let alive = false;
      for (const pixel of pixels) {
        pixel.life -= 1;
        if (pixel.life > 0) alive = true;
      }
      pixels = pixels.filter((pixel) => pixel.life > 0);
      render();
      if (alive) {
        raf = window.requestAnimationFrame(step);
      } else {
        running = false;
        raf = 0;
        context.clearRect(0, 0, width, height);
      }
    };

    const wake = () => {
      if (running) return;
      running = true;
      raf = window.requestAnimationFrame(step);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const cellX = Math.floor(event.clientX / CELL);
      const cellY = Math.floor(event.clientY / CELL);
      if (cellX === lastCellX && cellY === lastCellY) return;

      // Bresenham-style fill of the cells crossed since the previous event, so a
      // fast flick leaves a continuous trail instead of disconnected dots.
      if (lastCellX !== null && lastCellY !== null) {
        const dx = cellX - lastCellX;
        const dy = cellY - lastCellY;
        const steps = Math.min(Math.max(Math.abs(dx), Math.abs(dy)), 24);
        for (let i = 1; i < steps; i += 1) {
          pixels.push({
            x: (lastCellX + Math.round((dx * i) / steps)) * CELL,
            y: (lastCellY + Math.round((dy * i) / steps)) * CELL,
            life: LIFE,
          });
        }
      }

      lastCellX = cellX;
      lastCellY = cellY;
      pixels.push({ x: cellX * CELL, y: cellY * CELL, life: LIFE });
      if (pixels.length > 400) pixels = pixels.slice(-400);
      wake();
    };

    const onPointerLeave = () => {
      lastCellX = null;
      lastCellY = null;
    };

    // Re-read the accent colour whenever the theme toggles (data-theme on <html>).
    const observer = new MutationObserver(() => {
      primary = readPrimaryRgb();
    });

    const onVisibilityChange = () => {
      if (document.hidden) {
        window.cancelAnimationFrame(raf);
        raf = 0;
        running = false;
      }
    };

    resize();
    document.body.appendChild(canvas);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibilityChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      observer.disconnect();
      window.cancelAnimationFrame(raf);
      canvas.remove();
    };
  }, [enabled]);
}
