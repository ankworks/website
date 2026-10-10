/**
 * README renderer: GitHub-flavored Markdown converted to React elements.
 *
 * Security pipeline:
 * - remark-gfm parses tables, task lists, and strikethrough.
 * - `remarkHeadingIds` assigns GitHub-style anchor ids (with duplicate
 *   suffixes) to every heading before rendering.
 * - rehype-raw parses the raw HTML subset that GitHub allows; rehype-sanitize
 *   then reduces it to the safe schema in `src/shared/markdown-schema.ts`
 *   (no scripts, no event handlers, no style, no unsafe URL schemes).
 * - Links and images pass through the shared resolver: only http(s)/mailto
 *   links, and images only from an allowlisted set of hosts.
 * - Relative links become explorer routes pinned to the commit SHA.
 * - ```mermaid fences render through the sanitized Mermaid pipeline; every
 *   other fence is highlighted as text and never executed.
 */
import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { grammarForFenceTag } from '../../shared/languages';
import { MARKDOWN_SANITIZE_SCHEMA } from '../../shared/markdown-schema';
import { resolveMarkdownImage, resolveMarkdownLink, type LinkContext } from '../../shared/markdown-links';
import { remarkHeadingIds, slugify } from '../../shared/markdown-toc';
import HighlightedCode from './HighlightedCode';
import MermaidDiagram from './MermaidDiagram';

export { slugify };

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

function buildComponents(context: LinkContext): Components {
  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    function Heading({ children, id }: { children?: ReactNode; id?: string }) {
      const Tag = `h${level}` as const;
      return (
        <Tag id={id ?? slugify(textOf(children))} className={`markdown-heading markdown-h${level}`}>
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
    img({ src, alt, width, height, title }) {
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
    pre({ children }) {
      return <pre className="markdown-pre">{children}</pre>;
    },
    code({ className, children }) {
      const language = /language-(\S+)/.exec(className ?? '')?.[1];
      const code = textOf(children).replace(/\n$/, '');
      if (language === 'mermaid') {
        return <MermaidDiagram code={code} />;
      }
      const grammar = grammarForFenceTag(language);
      if (className && language) {
        return <HighlightedCode code={code} grammar={grammar ?? ''} className={className} />;
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
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkHeadingIds]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}
        components={buildComponents(context)}
      >
        {source}
      </ReactMarkdown>
    </article>
  );
}
