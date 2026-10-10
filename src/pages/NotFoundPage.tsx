import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-start gap-3 px-4 py-20 sm:px-6">
      <p className="font-mono text-sm text-primary">404</p>
      <h1 className="text-2xl font-semibold tracking-tight text-text">Page not found</h1>
      <p className="text-muted">The address does not match any page in the AnkWorks explorer.</p>
      <Link to="/" className="btn-secondary-sm mt-2">
        Back to repositories
      </Link>
    </div>
  );
}
