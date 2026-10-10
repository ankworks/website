import { useParams } from 'react-router-dom';
import NewIssueForm from '../components/collaboration/NewIssueForm';
import RepoShell from '../components/explorer/RepoShell';
import { issueListPath } from '../shared/routes';

/** "/repos/:repo/issues/new" — authenticated issue composer. */
export default function NewIssuePage() {
  const { repo = '' } = useParams();

  return (
    <RepoShell repo={repo} tab="issues">
      {({ detail }) => (
        <div className="mx-auto max-w-3xl">
          <NewIssueForm repo={detail.name} issuesEnabled={detail.has_issues} cancelHref={issueListPath(detail.name)} />
        </div>
      )}
    </RepoShell>
  );
}
