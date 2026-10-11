/**
 * Repository Markdown renderer (README, Markdown files, profile README, wiki).
 *
 * Security pipeline:
 * - remark-gfm parses tables, task lists, and strikethrough.
 * - `remarkAlerts` rewrites GitHub alert blockquotes (`> [!NOTE]`) into callouts
 *   before anything else, so the marker is never rendered as literal text.
 * - `remarkEmoji` expands `:shortcode:` outside code spans.
 * - `remarkHeadingIds` assigns GitHub-style anchor ids (with duplicate suffixes).
 * - rehype-raw parses the raw HTML subset that GitHub allows; rehype-sanitize
 *   then reduces it to the safe schema in `src/shared/markdown-schema.ts`
 *   (no scripts, no event handlers, no style, no unsafe URL schemes).
 * - Links and images pass through the shared resolver: only http(s)/mailto
 *   links, and images only from an allowlisted set of hosts.
 * - Relative links become explorer routes pinned to the commit SHA.
 * - ```mermaid fences render through the sanitized Mermaid pipeline; every
 *   other fence is highlighted as text and never executed.
 *
 * Typography, callouts, tables, task lists, and code blocks come from the shared
 * `markdown-components.tsx` so every Markdown surface looks the same.
 */
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { MARKDOWN_SANITIZE_SCHEMA } from '../../shared/markdown-schema';
import { resolveMarkdownImage, resolveMarkdownLink, type LinkContext } from '../../shared/markdown-links';
import { remarkAlerts } from '../../shared/remark-alerts';
import { remarkEmoji } from '../../shared/remark-emoji';
import { remarkHeadingIds, slugify } from '../../shared/markdown-toc';
import { buildMarkdownComponents } from './markdown-components';

export { slugify };

interface MarkdownProps {
  source: string;
  name: string;
  context: LinkContext;
}

export default function Markdown({ source, name, context }: MarkdownProps) {
  return (
    <article aria-label={`Rendered ${name}`} className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkAlerts, remarkEmoji, remarkHeadingIds]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}
        components={buildMarkdownComponents(context)}
      >
        {source}
      </ReactMarkdown>
    </article>
  );
}

export { resolveMarkdownImage, resolveMarkdownLink };
export type { LinkContext };
