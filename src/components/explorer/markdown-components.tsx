/**
 * Shared React components for every Markdown surface (V3 Markdown milestone).
 *
 * One component set is used for repository READMEs, repository Markdown files,
 * the organization profile README, wiki pages, issues, comments, pull requests,
 * discussions, and release notes — so typography, callouts, tables, task lists,
 * and code blocks look the same everywhere and are sanitized the same way.
 *
 * Security invariants preserved here:
 * - Code is rendered as React elements, never `innerHTML`; nothing executes.
 * - Links and images go through the shared resolvers (see
 *   `shared/markdown-links.ts`): only http(s)/mailto links, images only from
 *   allowlisted hosts, and relative paths are pinned to a commit SHA.
 * - Task-list checkboxes are always `disabled` + `readOnly`. Ticking a box in a
 *   rendered document can never issue a GitHub write; that needs the
 *   authenticated write API.
 * - Inline `<img>` is only rendered by surfaces that pass a resolver (`context`);
 *   comment surfaces render images as text labels.
 */

import { isValidElement, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { Link } from 'react-router-dom';
import { grammarForFenceTag, languageLabel } from '../../shared/languages';
import { resolveMarkdownImage, resolveMarkdownLink, type LinkContext } from '../../shared/markdown-links';
import { slugify } from '../../shared/markdown-toc';
import CodeBlock from './CodeBlock';
import HighlightedCode from './HighlightedCode';
import MermaidDiagram from './MermaidDiagram';

export function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** Minimal view of the hast element react-markdown hands to each component. */
interface ElementNode {
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: unknown[];
}

function classNameOf(node: unknown): string {
  const properties = (node as ElementNode | undefined)?.properties;
  const value = properties?.className;
  if (Array.isArray(value)) return value.map(String).join(' ');
  return typeof value === 'string' ? value : '';
}

function childElements(node: unknown): ElementNode[] {
  const children = (node as ElementNode | undefined)?.children;
  return Array.isArray(children) ? (children as ElementNode[]) : [];
}

/** Text content of a hast element, used to recover a code fence's source. */
function elementText(node: ElementNode): string {
  if (typeof (node as { value?: unknown }).value === 'string') return (node as { value: string }).value;
  return childElements(node).map(elementText).join('');
}

/**
 * Build the component map.
 *
 * `context` enables repository-relative links and images. Surfaces without a
 * repository context (issues, comments) pass `null`, which keeps only external
 * links and renders images as text.
 */
export function buildMarkdownComponents(context: LinkContext | null): Components {
  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    function Heading({ children, id }: { children?: ReactNode; id?: string }) {
      const Tag = `h${level}` as const;
      const anchor = id ?? slugify(textOf(children));
      return (
        <Tag id={anchor} className={`markdown-heading markdown-h${level}`}>
          {children}
          {/*
            Permalink. `aria-hidden` + `tabIndex={-1}` is deliberate (and is
            what GitHub does): the heading's accessible name must stay just its
            text, so screen readers and heading navigation are unaffected.
          */}
          {anchor ? (
            <a className="markdown-heading-anchor" href={`#${anchor}`} aria-hidden="true" tabIndex={-1}>
              #
            </a>
          ) : null}
        </Tag>
      );
    }
    Heading.displayName = `MarkdownH${level}`;
    return Heading;
  };

  return {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),

    a({ href, children }) {
      if (!context) {
        // Surfaces without a repository context still resolve anchors and safe
        // external links; anything else is rendered as plain text.
        const resolved = resolveMarkdownLink(href, { repo: '', commitSha: '', baseDir: '' });
        if (resolved.kind === 'anchor') {
          return <a href={resolved.href}>{children}</a>;
        }
        if (resolved.kind === 'external') {
          return (
            <a href={resolved.href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          );
        }
        return <span>{children}</span>;
      }
      const resolved = resolveMarkdownLink(href, context);
      switch (resolved.kind) {
        case 'internal':
          return <Link to={resolved.to}>{children}</Link>;
        case 'anchor':
          return <a href={resolved.href}>{children}</a>;
        case 'external':
          return (
            <a href={resolved.href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          );
        default:
          return <span>{children}</span>;
      }
    },

    img({ src, alt, width, height, title }) {
      if (!context) {
        return <span className="text-muted italic">[image{alt ? `: ${alt}` : ''}]</span>;
      }
      const url = resolveMarkdownImage(src, context);
      if (!url) {
        return <span className="text-muted italic">[image{alt ? `: ${alt}` : ''}]</span>;
      }
      return (
        <img
          src={url}
          alt={alt ?? ''}
          {...(width !== undefined ? { width } : {})}
          {...(height !== undefined ? { height } : {})}
          {...(title !== undefined ? { title } : {})}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="my-3 inline-block max-w-full rounded"
        />
      );
    },

    // Code fences: language label, copy button, wrap toggle, horizontal scroll.
    pre({ children, node }) {
      const codeNode = childElements(node).find((child) => child.tagName === 'code');
      const language = /language-([\w+#-]+)/.exec(classNameOf(codeNode ?? {}))?.[1] ?? null;
      const code = elementText(codeNode ?? {}).replace(/\n$/, '');

      if (language === 'mermaid') {
        return <MermaidDiagram code={code} />;
      }
      if (language) {
        return <CodeBlock code={code} language={language} />;
      }
      // No language: keep the original children so inline markup is preserved.
      return <pre className="markdown-pre">{children}</pre>;
    },

    code({ className, children }) {
      const language = /language-([\w+#-]+)/.exec(className ?? '')?.[1];
      const code = textOf(children).replace(/\n$/, '');
      if (!className || !language) {
        return <code className="markdown-inline-code">{children}</code>;
      }
      if (language === 'mermaid') return <MermaidDiagram code={code} />;
      const grammar = grammarForFenceTag(language);
      return <HighlightedCode code={code} grammar={grammar ?? ''} className={className} />;
    },

    // Tables stay scrollable on small screens and keep GFM alignment.
    table({ children }) {
      return (
        <div className="markdown-table-wrap my-4 w-full overflow-x-auto">
          <table className="markdown-table w-full border-collapse text-sm">{children}</table>
        </div>
      );
    },
    thead({ children }) {
      return <thead>{children}</thead>;
    },
    tbody({ children }) {
      return <tbody>{children}</tbody>;
    },
    // GFM alignment arrives as a react-markdown-generated `style` (the
    // sanitizer has already dropped any document-supplied `style`), so it is
    // safe to apply and keeps th/td visually aligned like GitHub.
    th({ children, style }) {
      return (
        <th scope="col" style={style} className="markdown-th">
          {children}
        </th>
      );
    },
    td({ children, style }) {
      return (
        <td style={style} className="markdown-td">
          {children}
        </td>
      );
    },

    blockquote({ children }) {
      return <blockquote className="markdown-blockquote">{children}</blockquote>;
    },

    hr() {
      return <hr className="markdown-hr" />;
    },

    // Task lists render as inert checkboxes: viewing a document cannot tick a
    // box on GitHub, and no request is made when one is clicked.
    input({ type, checked }) {
      if (type !== 'checkbox') return null;
      return (
        <input
          type="checkbox"
          checked={Boolean(checked)}
          disabled
          readOnly
          aria-disabled="true"
          className="markdown-task-checkbox"
        />
      );
    },

    li({ children, node }) {
      const hasCheckbox = childElements(node).some(
        (child) => child.tagName === 'input' && child.properties?.type === 'checkbox'
      );
      return <li className={hasCheckbox ? 'markdown-task-item' : undefined}>{children}</li>;
    },
  };
}

/** Fence tag → label, exposed for tests and for the code-block chrome. */
export { languageLabel };
