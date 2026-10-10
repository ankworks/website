import type { IssueLabel } from '../../types/collaboration';

export default function LabelList({ labels }: { labels: IssueLabel[] }) {
  if (labels.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Labels">
      {labels.map((label, index) => (
        <li key={`${label.name}-${index}`}>
          <span title={label.description ?? undefined} className="inline-flex max-w-52 truncate rounded-full border border-border bg-elevated px-2 py-0.5 text-[11px] font-medium text-muted">
            {label.name}
          </span>
        </li>
      ))}
    </ul>
  );
}
