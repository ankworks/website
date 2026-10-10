import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

function safeLink(value: string | null | undefined): string | null {
  if (!value) return null;
  const href = value.trim();
  if (/^#[A-Za-z0-9_.:-]{1,120}$/.test(href)) return href;
  if (/^mailto:[^\s<>]{1,1800}$/i.test(href)) return href;
  try {
    const url = new URL(href);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password && href.length <= 2048) {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

const components: Components = {
  a({ href, children }) {
    const safe = safeLink(href);
    return safe ? <a href={safe} target={safe.startsWith('#') ? undefined : '_blank'} rel={safe.startsWith('#') ? undefined : 'noopener noreferrer nofollow'}>{children}</a> : <span>{children}</span>;
  },
  img({ alt }) {
    return <span className="text-muted">[Image{alt ? `: ${alt}` : ''}]</span>;
  },
  pre({ children }) {
    return <pre className="markdown-pre">{children}</pre>;
  },
  table({ children }) {
    return <div className="my-4 overflow-x-auto"><table>{children}</table></div>;
  },
};

export default function IssueMarkdown({ source, label = 'Comment' }: { source: string; label?: string }) {
  if (!source.trim()) return <p className="text-sm italic text-muted">No description provided.</p>;
  return (
    <article aria-label={`Rendered ${label}`} className="markdown-body text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>{source}</ReactMarkdown>
    </article>
  );
}
