/**
 * README renderer: GitHub-flavored Markdown converted to React elements.
 *
 * Security:
 * - Raw HTML is skipped (skipHtml) and never parsed into the DOM.
 * - Links and images pass through the shared resolver: only http(s)/mailto
 *   links, and images only from an allowlisted set of hosts.
 * - Relative links become explorer routes pinned to the commit SHA.
 */
import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { grammarForFenceTag } from '../../shared/languages';
import { resolveMarkdownImage, resolveMarkdownLink, type LinkContext } from '../../shared/markdown-links';
import HighlightedCode from './HighlightedCode';

interface MarkdownProps {
  source: string;
  name: string;
  context: LinkContext;
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

/** GitHub-style heading anchor: lowercase, punctuation removed, spaces to hyphens. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function buildComponents(context: LinkContext): Components {
  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    function Heading({ children }: { children?: ReactNode }) {
      const Tag = `h${level}` as const;
      return (
        <Tag id={slugify(textOf(children))} className={`markdown-heading markdown-h${level}`}>
          {children}
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
    img({ src, alt }) {
      const url = resolveMarkdownImage(src, context);
      if (!url) {
        return <span className="text-muted italic">[image{alt ? `: ${alt}` : ''}]</span>;
      }
      return (
        <img
          src={url}
          alt={alt ?? ''}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="my-3 inline-block max-w-full rounded"
        />
      );
    },
    pre({ children }) {
      return <pre className="markdown-pre">{children}</pre>;
    },
    code({ className, children }) {
      const language = /language-(\S+)/.exec(className ?? '')?.[1];
      const grammar = grammarForFenceTag(language);
      if (className && language) {
        return <HighlightedCode code={textOf(children).replace(/\n$/, '')} grammar={grammar ?? ''} className={className} />;
      }
      return <code className={className}>{children}</code>;
    },
    table({ children }) {
      return (
        <div className="my-4 overflow-x-auto">
          <table>{children}</table>
        </div>
      );
    },
    input({ type, checked }) {
      if (type !== 'checkbox') return null;
      return <input type="checkbox" checked={Boolean(checked)} disabled readOnly className="mr-2 align-middle accent-primary" />;
    },
  };
}

export default function Markdown({ source, name, context }: MarkdownProps) {
  return (
    <article aria-label={`Rendered ${name}`} className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={buildComponents(context)}>
        {source}
      </ReactMarkdown>
    </article>
  );
}
