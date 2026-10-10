import { useParams, useSearchParams } from 'react-router-dom';
import RepoShell from '../components/explorer/RepoShell';
import CommitHistory from '../components/explorer/CommitHistory';
import { ErrorState } from '../components/explorer/ui';
import { decodeRouteRef } from '../shared/routes';
import { isValidRef, parsePositiveInt } from '../shared/validation';

/** "/repos/:repo/commits/:ref?page=N" — paginated commit history. */
export default function CommitsPage() {
  const { repo = '', ref: refParam = '' } = useParams();
  const [params] = useSearchParams();
  const page = parsePositiveInt(params.get('page'), 1, 10_000);
  const gitRef = decodeRouteRef(refParam);
  const validRef = gitRef !== null && isValidRef(gitRef) ? gitRef : null;

  return (
    <RepoShell repo={repo} tab="commits" gitRef={validRef ?? undefined}>
      {() => {
        if (validRef === null) return <ErrorState error={new Error('Invalid ref')} title="Invalid branch or commit" />;
        if (page === null) return <ErrorState error={new Error('Invalid page')} title="Invalid page number" />;
        return <CommitHistory repo={repo} gitRef={validRef} page={page} />;
      }}
    </RepoShell>
  );
}
