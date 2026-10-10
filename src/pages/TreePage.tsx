import { useParams } from 'react-router-dom';
import RepoShell from '../components/explorer/RepoShell';
import RepositoryBrowser from '../components/explorer/RepositoryBrowser';
import { ErrorState } from '../components/explorer/ui';
import { decodeRouteRef } from '../shared/routes';
import { isValidRef, normalizeRepoPath } from '../shared/validation';

/** "/repos/:repo/tree/:ref/*" — directory explorer. The ref is one encoded segment; the rest is the path. */
export default function TreePage() {
  const { repo = '', ref: refParam = '', '*': splat = '' } = useParams();
  const gitRef = decodeRouteRef(refParam);
  const validRef = gitRef !== null && isValidRef(gitRef) ? gitRef : null;
  const path = normalizeRepoPath(splat);

  return (
    <RepoShell repo={repo} tab="code" gitRef={validRef ?? undefined}>
      {() => {
        if (validRef === null) return <ErrorState error={new Error('Invalid ref')} title="Invalid branch or commit" />;
        if (path === null) return <ErrorState error={new Error('Invalid path')} title="Invalid path" />;
        return <RepositoryBrowser repo={repo} gitRef={validRef} path={path} showReadme={false} />;
      }}
    </RepoShell>
  );
}
