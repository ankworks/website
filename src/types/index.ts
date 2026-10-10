// GitHub Repository Types
export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: {
    login: string;
    id: number;
    avatar_url: string;
    html_url: string;
  };
  html_url: string;
  description: string | null;
  fork: boolean;
  url: string;
  forks_url: string;
  keys_url: string;
  collaborators_url: string;
  teams_url: string;
  hooks_url: string;
  issue_events_url: string;
  events_url: string;
  assignees_url: string;
  branches_url: string;
  tags_url: string;
  blobs_url: string;
  git_tags_url: string;
  git_refs_url: string;
  trees_url: string;
  statuses_url: string;
  languages_url: string;
  stargazers_url: string;
  contributors_url: string;
  subscribers_url: string;
  subscription_url: string;
  commits_url: string;
  git_commits_url: string;
  comments_url: string;
  issue_comment_url: string;
  contents_url: string;
  compare_url: string;
  merges_url: string;
  archive_url: string;
  downloads_url: string;
  issues_url: string;
  pulls_url: string;
  milestones_url: string;
  notifications_url: string;
  labels_url: string;
  releases_url: string;
  deployments_url: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  git_url: string;
  ssh_url: string;
  clone_url: string;
  svn_url: string;
  homepage: string | null;
  size: number;
  stargazers_count: number;
  watchers_count: number;
  language: string | null;
  has_issues: boolean;
  has_projects: boolean;
  has_downloads: boolean;
  has_wiki: boolean;
  has_pages: boolean;
  has_discussions: boolean;
  forks_count: number;
  mirror_url: string | null;
  archived: boolean;
  disabled: boolean;
  open_issues_count: number;
  license: {
    key: string;
    name: string;
    spdx_id: string;
    url: string | null;
    node_id: string;
  } | null;
  allow_forking: boolean;
  is_template: boolean;
  web_commit_signoff_required: boolean;
  topics: string[];
  visibility: string;
  forks: number;
  open_issues: number;
  watchers: number;
  default_branch: string;
  temp_clone_token: string | null;
  network_count: number;
  subscribers_count: number;
}

export interface Repository {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  updated_at: string;
  created_at: string;
  archived: boolean;
  fork: boolean;
  size: number;
  open_issues_count: number;
  topics: string[];
  /** Default branch name (validated ref), or "" when unknown. */
  default_branch: string;
}

// API Response Types

/** Successful response of GET /api/repos (public repositories only). */
export interface RepositoriesResponse {
  org: string;
  repos: Repository[];
  total_count: number;
  fetched_at: string;
}

/** Error response returned by the Worker API. Never contains upstream secrets. */
export interface ApiError {
  error: string;
  message: string;
  status: number;
}

// Organization Stats Types
export interface OrganizationStats {
  total_repos: number;
  total_stars: number;
  total_forks: number;
  languages: Record<string, number>;
  most_starred: Repository | null;
  recently_updated: Repository | null;
}

// UI State Types
export interface FilterState {
  search: string;
  language: string;
  sort_by: 'stars' | 'updated' | 'name' | 'forks';
  sort_order: 'asc' | 'desc';
  include_forks: boolean;
}

export type SortBy = 'stars' | 'updated' | 'name' | 'forks';
export type SortOrder = 'asc' | 'desc';

// Navigation Types
export interface NavItem {
  label: string;
  path: string;
  external?: boolean;
}

// ---------------------------------------------------------------------------
// Repository explorer (read-only). All upstream data is sanitized by the Worker.
// ---------------------------------------------------------------------------

/** Repository metadata from GET /api/repos/:repo. */
export interface RepositoryDetail extends Repository {
  pushed_at: string;
  license: string | null;
  homepage: string | null;
  has_wiki: boolean;
}

export interface RepositoryDetailResponse {
  repo: RepositoryDetail;
}

/** Organization profile from GET /api/org. */
export interface OrganizationInfo {
  login: string;
  name: string | null;
  description: string | null;
  avatar_url: string;
  html_url: string;
  blog: string | null;
  location: string | null;
  public_repos: number;
  created_at: string;
}

export interface OrganizationResponse {
  org: OrganizationInfo;
}

export interface BranchInfo {
  name: string;
  sha: string;
  protected: boolean;
}

export interface BranchesResponse {
  branches: BranchInfo[];
  page: number;
  per_page: number;
  has_next: boolean;
}

export interface CommitSummary {
  sha: string;
  /** First line of the commit message. */
  title: string;
  /** Full commit message (truncated to a safe length by the Worker). */
  message: string;
  author_name: string;
  author_login: string | null;
  /** Committer date (ISO 8601). */
  date: string;
  html_url: string;
}

export interface CommitsResponse {
  ref: string;
  commits: CommitSummary[];
  page: number;
  per_page: number;
  has_next: boolean;
}

export type EntryType = 'file' | 'dir' | 'symlink' | 'submodule';

export interface DirectoryEntry {
  name: string;
  path: string;
  type: EntryType;
  size: number;
  sha: string;
  html_url: string;
}

export interface TreeResponse {
  repo: string;
  ref: string;
  commit_sha: string;
  path: string;
  entries: DirectoryEntry[];
  /** True when GitHub returned the maximum number of entries (listing may be incomplete). */
  truncated: boolean;
}

export interface LastCommitResponse {
  path: string;
  commit: CommitSummary | null;
}

export type FileKind = 'text' | 'binary' | 'lfs-pointer' | 'too-large' | 'symlink' | 'submodule';

export interface FileResponse {
  repo: string;
  ref: string;
  commit_sha: string;
  path: string;
  name: string;
  kind: FileKind;
  size: number;
  blob_sha: string;
  html_url: string;
  /** Decoded UTF-8 text; present only when kind === 'text'. */
  content?: string;
  /** Symlink target (kind === 'symlink'). Never followed. */
  target?: string | null;
  /** External GitHub URL of a submodule (kind === 'submodule'). */
  submodule_url?: string | null;
}

export interface ReadmeResponse {
  repo: string;
  commit_sha: string;
  path: string;
  name: string;
  kind: 'text' | 'binary' | 'too-large';
  size: number;
  content?: string;
}
