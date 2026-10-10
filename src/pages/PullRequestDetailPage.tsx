import { useParams } from 'react-router-dom';
import RepoShell from '../components/explorer/RepoShell';
import { ErrorState } from '../components/explorer/ui';
import PullRequestDetail from '../components/collaboration/PullRequestDetail';

export default function PullRequestDetailPage() {
  const { repo = '', number: numberValue = '' } = useParams();
  const number = /^\d{1,10}$/.test(numberValue) ? Number(numberValue) : 0;

  return (
    <RepoShell repo={repo} tab="pulls">
      {({ detail }) => number > 0 && Number.isSafeInteger(number)
        ? <PullRequestDetail repo={detail.name} number={number} />
        : <ErrorState error={new Error('Invalid pull request number')} title="Invalid pull request number" />}
    </RepoShell>
  );
}
