import { Link } from 'react-router-dom';
import type { ActivityResponse, OrganizationEvent } from '../types/collaboration';
import { useAsync } from '../hooks/useAsync';
import { explorerApi } from '../api/explorer';
import { formatDate, formatRelative } from '../lib/format';
import { ActivityIcon } from './explorer/icons';
import { EmptyState, ErrorState, SkeletonRows } from './explorer/ui';

export default function ActivityFeed() {
  const state = useAsync('organization-activity', () => explorerApi.activity(10));

  return (
    <section aria-labelledby="activity-heading" className="overflow-hidden rounded-lg border border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 id="activity-heading" className="flex items-center gap-2 text-sm font-semibold text-text">
          <ActivityIcon size={15} className="text-muted" /> Recent activity
        </h2>
        {state.data?.fetched_at && <time className="text-xs text-muted" dateTime={state.data.fetched_at}>Live from GitHub</time>}
      </header>
      {state.status === 'loading' || state.status === 'idle' ? (
        <SkeletonRows rows={5} label="Loading organization activity" />
      ) : state.status === 'error' ? (
        <div className="p-3"><ErrorState error={state.error} onRetry={state.reload} compact /></div>
      ) : state.data?.events.length ? (
        <ol className="divide-y divide-border" aria-label="Recent organization activity">
          {state.data.events.map((event) => <ActivityRow key={event.id} event={event} />)}
        </ol>
      ) : (
        <EmptyState title="No recent public activity." />
      )}
    </section>
  );
}

function ActivityRow({ event }: { event: OrganizationEvent }) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-elevated text-muted" aria-hidden="true">
        <ActivityIcon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-5 text-text">
          <span className="font-medium">{event.actor}</span> {event.summary}{' '}
          <Link to={event.href} className="font-medium text-primary hover:underline">{event.repo}</Link>
        </p>
        <time dateTime={event.created_at} title={formatDate(event.created_at)} className="mt-1 block text-xs text-muted">
          {formatRelative(event.created_at)}
        </time>
      </div>
    </li>
  );
}

export function ActivityFeedSkeleton() {
  return <SkeletonRows rows={5} label="Loading organization activity" />;
}

export type { ActivityResponse };
