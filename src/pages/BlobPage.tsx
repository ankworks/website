import { useParams } from 'react-router-dom';
import RepoShell from '../components/explorer/RepoShell';
import FileView from '../components/explorer/FileView';
import { ErrorState } from '../components/explorer/ui';
import { decodeRouteRef } from '../shared/routes';
import { isValidRef, normalizeRepoPath } from '../shared/validation';

/** "/repos/:repo/blob/:ref/*" — source file viewer. */
export default function BlobPage() {
  const { repo = '', ref: refParam = '', '*': splat = '' } = useParams();
  const gitRef = decodeRouteRef(refParam);
  const validRef = gitRef !== null && isValidRef(gitRef) ? gitRef : null;
  const path = normalizeRepoPath(splat);

  return (
    <RepoShell repo={repo} tab="code" gitRef={validRef ?? undefined}>
      {() => {
        if (validRef === null) return <ErrorState error={new Error('Invalid ref')} title="Invalid branch or commit" />;
        if (path === null || path === '') return <ErrorState error={new Error('Invalid path')} title="Invalid file path" />;
        return <FileView repo={repo} gitRef={validRef} path={path} />;
      }}
    </RepoShell>
  );
}
