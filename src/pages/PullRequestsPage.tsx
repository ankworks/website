import { Link, useParams } from 'react-router-dom';
import RepoShell from '../components/explorer/RepoShell';
import PullRequestList from '../components/collaboration/PullRequestList';
import { PullRequestIcon } from '../components/explorer/icons';

export default function PullRequestsPage() {
  const { repo } = useParams();
  if (repo) {
    return <RepoShell repo={repo} tab="pulls">{({ detail }) => <PullRequestList repo={detail.name} />}</RepoShell>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <header className="border-b border-border pb-5">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted"><PullRequestIcon size={14} /> Organization</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">Pull Requests</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">Public pull requests across AnkWorks repositories.</p>
        <p className="mt-2 text-xs text-muted"><Link to="/repos" className="text-primary hover:underline">Browse repositories</Link></p>
      </header>
      <PullRequestList repo={null} />
    </div>
  );
}
