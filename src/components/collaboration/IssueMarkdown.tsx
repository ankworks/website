/**
 * Markdown renderer for user-authored content: issues, issue comments, pull
 * requests, PR comments, discussions, discussion comments, and release notes.
 *
 * It shares the repository README's component set (callouts, tables, task
 * lists, code blocks, emoji) so every Markdown surface looks identical, with
 * two deliberate differences:
 *
 * - `skipHtml`: raw HTML in a comment is NOT parsed. Comments are untrusted
 *   user input and there is no reason to accept their markup; text, GFM,
 *   alerts, and emoji are enough. rehype-sanitize still runs as defence in
 *   depth.
 * - No repository context: relative links are not resolved to explorer routes
 *   and images render as text labels, because a comment has no repository
 *   directory to be relative to.
 *
 * Nothing here executes: code fences are highlighted as text, task-list
 * checkboxes are inert, and links are protocol-checked.
 */

import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { MARKDOWN_SANITIZE_SCHEMA } from '../../shared/markdown-schema';
import { remarkAlerts } from '../../shared/remark-alerts';
import { remarkEmoji } from '../../shared/remark-emoji';
import { buildMarkdownComponents } from '../explorer/markdown-components';

const components = buildMarkdownComponents(null);

export default function IssueMarkdown({ source, label = 'Comment' }: { source: string; label?: string }) {
  if (!source.trim()) return <p className="text-sm italic text-muted">No description provided.</p>;
  return (
    <article aria-label={`Rendered ${label}`} className="markdown-body text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkAlerts, remarkEmoji]}
        rehypePlugins={[[rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}
        skipHtml
        components={components}
      >
        {source}
      </ReactMarkdown>
    </article>
  );
}
