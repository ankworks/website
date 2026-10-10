import { Link, useParams } from 'react-router-dom';
import RepoShell from '../components/explorer/RepoShell';
import { IssueIcon } from '../components/explorer/icons';
import IssueList from '../components/collaboration/IssueList';
import NewIssueForm from '../components/collaboration/NewIssueForm';
import { AdminModerationPanel, GuestIssueForm } from '../components/collaboration/GuestIssueForm';

export default function IssuesPage() {
  const { repo } = useParams();
  if (repo) {
    return <RepoShell repo={repo} tab="issues">{({ detail }) => <IssueList repo={detail.name} issuesEnabled={detail.has_issues} />}</RepoShell>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <header className="border-b border-border pb-5">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-muted"><IssueIcon size={14} /> Organization</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-text">Issues</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">Public issues across AnkWorks repositories.</p>
        <p className="mt-2 text-xs text-muted"><Link to="/repos" className="text-primary hover:underline">Browse repositories</Link></p>
      </header>

      {/* Opening an issue with your own GitHub account is the primary path; the
          guest queue is a fallback for visitors without one. */}
      <div id="new-issue" className="scroll-mt-24">
        <NewIssueForm />
      </div>

      <IssueList repo={null} />

      <AdminModerationPanel />

      <section aria-label="Submitting without a GitHub account" className="space-y-2">
        <h2 className="text-sm font-semibold text-text">Without a GitHub account</h2>
        <GuestIssueForm />
      </section>
    </div>
  );
}
