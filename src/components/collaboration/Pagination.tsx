import { Link } from 'react-router-dom';

export default function Pagination({
  page,
  hasNext,
  previous,
  next,
  label,
}: {
  page: number;
  hasNext: boolean;
  previous: string;
  next: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3 text-sm">
      {page > 1 ? <Link to={previous} rel="prev" className="btn-secondary-sm">← Newer</Link> : <span aria-disabled="true" className="btn-secondary-sm pointer-events-none opacity-40">← Newer</span>}
      <span className="text-xs text-muted">Page {page}</span>
      {hasNext ? <Link to={next} rel="next" className="btn-secondary-sm">Older →</Link> : <span aria-disabled="true" className="btn-secondary-sm pointer-events-none opacity-40">Older →</span>}
    </nav>
  );
}
