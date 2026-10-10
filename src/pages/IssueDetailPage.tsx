import { useParams } from 'react-router-dom';
import RepoShell from '../components/explorer/RepoShell';
import { ErrorState } from '../components/explorer/ui';
import IssueDetail from '../components/collaboration/IssueDetail';

export default function IssueDetailPage() {
  const { repo = '', number: numberValue = '' } = useParams();
  const number = /^\d{1,10}$/.test(numberValue) ? Number(numberValue) : 0;

  return (
    <RepoShell repo={repo} tab="issues">
      {({ detail }) => number > 0 && Number.isSafeInteger(number)
        ? <IssueDetail repo={detail.name} number={number} />
        : <ErrorState error={new Error('Invalid issue number')} title="Invalid issue number" />}
    </RepoShell>
  );
}
