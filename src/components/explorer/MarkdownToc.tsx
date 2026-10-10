/**
 * Table of contents for rendered Markdown documents ("On this page").
 *
 * Links target the GitHub-style heading anchors that `remarkHeadingIds`
 * assigns during rendering, so the outline and the document never drift.
 */
import { extractHeadings, type TocHeading } from '../../shared/markdown-toc';

/** Indent classes per heading depth (static strings so Tailwind keeps them). */
const DEPTH_CLASS = ['', 'ml-3', 'ml-6', 'ml-8', 'ml-10', 'ml-12'];

interface MarkdownTocProps {
  source: string;
  /** Hide the outline until the document has at least this many headings. */
  minHeadings?: number;
  className?: string;
}

export default function MarkdownToc({ source, minHeadings = 3, className = '' }: MarkdownTocProps) {
  const headings = extractHeadings(source);
  if (headings.length < minHeadings) return null;

  return (
    <nav aria-label="Table of contents" className={`markdown-toc ${className}`.trim()}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">On this page</p>
      <ul className="mt-2 space-y-1.5">
        {headings.map((heading: TocHeading) => (
          <li key={heading.slug} className={DEPTH_CLASS[Math.min(heading.depth - 1, DEPTH_CLASS.length - 1)]}>
            <a
              href={`#${heading.slug}`}
              className="block truncate text-xs leading-5 text-muted transition-colors hover:text-primary"
            >
              {heading.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
