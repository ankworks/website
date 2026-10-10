import { useParams } from 'react-router-dom';
import RepoShell from '../components/explorer/RepoShell';
import RepositoryBrowser from '../components/explorer/RepositoryBrowser';

/** "/repos/:repo" — repository home: root directory and README on the default branch. */
export default function RepositoryPage() {
  const { repo = '' } = useParams();
  return (
    <RepoShell repo={repo} tab="code">
      {({ detail, defaultRef }) => (
        <RepositoryBrowser repo={detail.name} gitRef={defaultRef} path="" showReadme />
      )}
    </RepoShell>
  );
}
