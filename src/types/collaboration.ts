import type { CommitSummary } from './index';

export type CollaborationState = 'open' | 'closed' | 'all';
export type IssueState = Exclude<CollaborationState, 'all'>;

export interface IssueLabel {
  name: string;
  color: string | null;
  description: string | null;
}

export interface Collaborator {
  login: string | null;
  avatar_url: string | null;
}

export interface IssueSummary {
  number: number;
  repo: string;
  title: string;
  body: string | null;
  state: IssueState;
  state_reason: string | null;
  author: Collaborator | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  comments: number;
  labels: IssueLabel[];
  html_url: string;
}

export interface IssueListResponse {
  items: IssueSummary[];
  total_count: number | null;
  state: CollaborationState;
  page: number;
  per_page: number;
  has_next: boolean;
}

export interface IssueComment {
  id: number;
  author: Collaborator | null;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface IssueCommentsResponse {
  comments: IssueComment[];
  page: number;
  per_page: number;
  has_next: boolean;
}

export interface PullRequestDetail extends IssueSummary {
  draft: boolean;
  merged: boolean;
  merged_at: string | null;
  base_ref: string | null;
  base_sha: string | null;
  head_ref: string | null;
  head_sha: string | null;
  additions: number;
  deletions: number;
  changed_files: number;
  commits_count: number;
}

export interface PullRequestListResponse {
  items: PullRequestDetail[];
  total_count: number | null;
  state: CollaborationState;
  page: number;
  per_page: number;
  has_next: boolean;
}

export interface PullRequestFile {
  filename: string;
  previous_filename: string | null;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
}

export interface PullRequestFilesResponse {
  files: PullRequestFile[];
  page: number;
  per_page: number;
  has_next: boolean;
}

export interface PullRequestCommitsResponse {
  commits: CommitSummary[];
  page: number;
  per_page: number;
  has_next: boolean;
}

export interface PullRequestReviewComment extends IssueComment {
  path: string | null;
  commit_id: string | null;
}

export interface PullRequestReviewCommentsResponse {
  comments: PullRequestReviewComment[];
  page: number;
  per_page: number;
  has_next: boolean;
}

export interface TagInfo {
  name: string;
  sha: string;
}

export interface TagsResponse {
  tags: TagInfo[];
  page: number;
  per_page: number;
  has_next: boolean;
}

export type OrganizationEventKind = 'push' | 'issue' | 'pull' | 'comment' | 'release' | 'branch' | 'star' | 'fork';

export interface OrganizationEvent {
  id: string;
  kind: OrganizationEventKind;
  actor: string;
  repo: string;
  summary: string;
  created_at: string;
  href: string;
}

export interface ActivityResponse {
  events: OrganizationEvent[];
  fetched_at: string;
}
