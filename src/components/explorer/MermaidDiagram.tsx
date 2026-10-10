/**
 * Mermaid diagram rendering for ```mermaid code fences.
 *
 * Safety model:
 * - mermaid runs with `securityLevel: 'strict'` and `htmlLabels: false`; it
 *   DOMPurify-sanitizes its own output and disables interactive callbacks.
 * - `sanitizeMermaidSvg` scrubs the result again: no script/foreignObject/
 *   iframe, no event-handler attributes, no anchors, and non-https URLs are
 *   dropped. Diagram text is never executed.
 * - Theme CSS and inline styles are re-applied through the CSSOM
 *   (`CSSStyleSheet` + `el.style.cssText`) instead of markup. The site's CSP
 *   allows `style-src 'self'`, which blocks `<style>` elements and `style`
 *   attributes parsed from markup but not CSSOM writes.
 * - Rendering failures fall back to showing the diagram source as plain text.
 *
 * The mermaid library is lazy-loaded: sites without diagrams never download it.
 */
import { useEffect, useRef, useState } from 'react';

type RenderState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

let diagramCounter = 0;

/** Theme CSS blocks already installed via CSSOM, keyed by their text. */
const installedCss = new Set<string>();

/** Elements whose inline styles must be re-applied through the CSSOM. */
export interface StyledSvgElement {
  element: Element;
  cssText: string;
}

export interface SanitizedSvg {
  svg: SVGSVGElement | null;
  /** Theme CSS extracted from `<style>` elements inside the diagram. */
  css: string;
  /** Inline `style` attribute texts, re-applied via CSSOM after insertion. */
  styled: StyledSvgElement[];
}

const REMOVED_ELEMENTS = 'script, style, iframe, object, embed, foreignObject, animate, animateTransform, set';

function isSafeUrl(value: string): boolean {
  return /^https:\/\//i.test(value.trim());
}

/**
 * Scrub a rendered mermaid SVG for display. Returns the sanitized element and
 * the styling that the page must apply through the CSSOM. Exported for tests.
 */
export function sanitizeMermaidSvg(markup: string): SanitizedSvg {
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const svg = doc.querySelector('svg');
  if (!svg) return { svg: null, css: '', styled: [] };

  let css = '';
  for (const node of Array.from(svg.querySelectorAll('style'))) {
    css += `${node.textContent ?? ''}\n`;
    node.remove();
  }
  for (const node of Array.from(svg.querySelectorAll(REMOVED_ELEMENTS))) {
    node.remove();
  }
  // Links inside diagrams are unwrapped: keep the label, drop navigation.
  for (const anchor of Array.from(svg.querySelectorAll('a'))) {
    anchor.replaceWith(...Array.from(anchor.childNodes));
  }

  const styled: StyledSvgElement[] = [];
  for (const element of Array.from(svg.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if ((name === 'href' || name === 'src' || name.endsWith(':href')) && !isSafeUrl(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
    const cssText = element.getAttribute('style');
    if (cssText !== null) {
      element.removeAttribute('style');
      styled.push({ element, cssText });
    }
  }
  return { svg, css, styled };
}

/** Install mermaid theme CSS through the CSSOM (never as markup). */
function installDiagramCss(css: string): void {
  const trimmed = css.trim();
  if (trimmed === '' || installedCss.has(trimmed)) return;
  installedCss.add(trimmed);
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(trimmed);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    // Without constructed stylesheets the diagram still renders; only theme
    // colors are missing. Never fall back to injecting <style> markup (CSP).
  }
}

/** Re-apply inline styles through the CSSOM after the SVG is in the document. */
function applyStyledElements(styled: StyledSvgElement[]): void {
  for (const { element, cssText } of styled) {
    try {
      (element as HTMLElement | SVGElement).style.cssText = cssText;
    } catch {
      // A malformed declaration is skipped; the diagram remains readable.
    }
  }
}

/** Follow the site theme (`data-theme` on <html>) when rendering diagrams. */
function useThemeName(): 'dark' | 'light' {
  const current = (): 'dark' | 'light' =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const [theme, setTheme] = useState<'dark' | 'light'>(current);

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(current()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  return theme;
}

export default function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<RenderState>({ status: 'loading' });
  const [renderId] = useState(() => {
    diagramCounter += 1;
    return `mermaid-diagram-${diagramCounter}`;
  });
  const theme = useThemeName();

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          htmlLabels: false,
          theme: theme === 'light' ? 'default' : 'dark',
        });
        const { svg: markup } = await mermaid.render(`${renderId}-${theme}`, code);
        if (cancelled) return;
        const { svg, css, styled } = sanitizeMermaidSvg(markup);
        const container = containerRef.current;
        if (!svg || !container) {
          throw new Error('The diagram produced no SVG output.');
        }
        container.replaceChildren(svg);
        installDiagramCss(css);
        applyStyledElements(styled);
        setState({ status: 'ready' });
      } catch (error) {
        if (!cancelled) {
          setState({ status: 'error', message: error instanceof Error ? error.message : 'Rendering failed.' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, theme, renderId]);

  if (state.status === 'error') {
    return (
      <div className="my-4 rounded-md border border-border bg-elevated/40 p-4" role="note" data-testid="mermaid-diagram">
        <p className="text-xs font-medium text-muted">This Mermaid diagram could not be rendered. Showing its source instead.</p>
        <pre className="markdown-pre mt-2">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="mermaid-diagram my-4" data-testid="mermaid-diagram">
      {state.status === 'loading' && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-elevated/40 px-4 py-3 text-xs text-muted" role="status">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
          Rendering diagram…
        </div>
      )}
      <div ref={containerRef} className={state.status === 'ready' ? 'overflow-x-auto' : 'h-0 overflow-hidden'} />
    </div>
  );
}
