import { Link } from 'react-router-dom';
import { blobPath, treePath } from '../../shared/routes';
import { splitPath } from '../../shared/validation';

interface BreadcrumbsProps {
  repo: string;
  gitRef: string;
  path: string;
  /** When true, the last segment is a file and links to the blob view. */
  isFile?: boolean;
}

/** Repository → directories → file. Every segment links to its tree at the same ref. */
export default function Breadcrumbs({ repo, gitRef, path, isFile = false }: BreadcrumbsProps) {
  const segments = splitPath(path);
  const items = segments.map((segment, index) => {
    const prefix = segments.slice(0, index + 1).join('/');
    const last = index === segments.length - 1;
    const to = last && isFile ? blobPath(repo, gitRef, prefix) : treePath(repo, gitRef, prefix);
    return { label: segment, to, current: last };
  });

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 text-sm">
        <li className="min-w-0">
          {segments.length === 0 ? (
            <span aria-current="page" className="font-medium text-text">
              {repo}
            </span>
          ) : (
            <Link to={treePath(repo, gitRef)} className="font-medium text-primary/90 hover:text-primary">
              {repo}
            </Link>
          )}
        </li>
        {items.map((item) => (
          <li key={item.to} className="flex min-w-0 items-center gap-1">
            <span aria-hidden="true" className="text-muted/60">
              /
            </span>
            {item.current ? (
              <span aria-current="page" className="truncate font-medium text-text">
                {item.label}
              </span>
            ) : (
              <Link to={item.to} className="truncate text-primary/90 hover:text-primary">
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
