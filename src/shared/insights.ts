/**
 * Shared types and response guards for repository insights (V3-A).
 *
 * Every number in these types comes straight from the GitHub API. The Worker
 * never invents, interpolates, or estimates a statistic: when GitHub does not
 * return a value the field stays at its documented fallback (0 / null), and the
 * UI is expected to render "—" instead of a guess.
 *
 * Keep this file free of DOM and Workers-only APIs.
 */

// ---------------------------------------------------------------------------
// Contributors
// ---------------------------------------------------------------------------

export interface Contributor {
  login: string | null;
  avatar_url: string | null;
  html_url: string;
  contributions: number;
}

export interface ContributorsResponse {
  contributors: Contributor[];
  page: number;
  per_page: number;
  has_next: boolean;
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

export interface LanguageStat {
  name: string;
  bytes: number;
  /** Share of the repository in percent, rounded to one decimal. */
  percent: number;
}

export interface LanguagesResponse {
  total_bytes: number;
  languages: LanguageStat[];
  fetched_at: string;
}

// ---------------------------------------------------------------------------
// Releases
// ---------------------------------------------------------------------------

export interface ReleaseAsset {
  id: number;
  name: string;
  content_type: string;
  size: number;
  download_count: number;
  /**
   * GitHub-hosted download link only (github.com or objects.githubusercontent.com).
   * The Worker never proxies release binaries: downloads go straight to GitHub.
   */
  browser_download_url: string;
}

export interface Release {
  id: number;
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at: string;
  /** Release notes (Markdown), truncated by the Worker. Never rendered as HTML. */
  body: string | null;
  author: string | null;
  html_url: string;
  assets: ReleaseAsset[];
}

export interface ReleasesResponse {
  releases: Release[];
  page: number;
  per_page: number;
  has_next: boolean;
}

// ---------------------------------------------------------------------------
// GitHub Actions (read-only)
// ---------------------------------------------------------------------------

export interface Workflow {
  id: number;
  name: string;
  path: string;
  state: string;
  html_url: string;
}

export interface WorkflowsResponse {
  total_count: number;
  workflows: Workflow[];
  page: number;
  per_page: number;
  has_next: boolean;
}

export type WorkflowRunConclusion =
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'neutral'
  | 'stale'
  | 'startup_failure'
  | null;

export interface WorkflowRun {
  id: number;
  name: string | null;
  display_title: string;
  status: string;
  conclusion: WorkflowRunConclusion;
  event: string;
  head_branch: string | null;
  head_sha: string;
  run_number: number;
  created_at: string;
  updated_at: string;
  run_started_at: string | null;
  /** Wall-clock duration in ms, derived from run_started_at → updated_at. */
  duration_ms: number | null;
  actor: string | null;
  workflow_id: number | null;
  /** GitHub UI link for the run (never embeds logs or secrets). */
  html_url: string;
}

export interface WorkflowRunsResponse {
  total_count: number;
  runs: WorkflowRun[];
  page: number;
  per_page: number;
  has_next: boolean;
}

// ---------------------------------------------------------------------------
// Repository documents (README / Contributing / License / Security tabs)
// ---------------------------------------------------------------------------

export type RepoDocKey = 'readme' | 'contributing' | 'license' | 'security';

export const REPO_DOC_KEYS: readonly RepoDocKey[] = ['readme', 'contributing', 'license', 'security'];

export const REPO_DOC_LABELS: Record<RepoDocKey, string> = {
  readme: 'README',
  contributing: 'Contributing',
  license: 'License',
  security: 'Security',
};

export interface RepoDocSummary {
  key: RepoDocKey;
  label: string;
  path: string;
  name: string;
}

export interface RepoDocsResponse {
  repo: string;
  commit_sha: string;
  /** Only documents that actually exist at the requested ref. */
  docs: RepoDocSummary[];
}

export interface RepoDocResponse {
  repo: string;
  commit_sha: string;
  key: RepoDocKey;
  path: string;
  name: string;
  kind: 'text' | 'binary' | 'too-large';
  size: number;
  html_url: string;
  /** Markdown source; present only when kind === 'text'. */
  content?: string;
}

// ---------------------------------------------------------------------------
// Featured (pinned) repositories
// ---------------------------------------------------------------------------

export interface FeaturedRepo {
  repo: string;
  position: number;
}

export interface FeaturedReposResponse {
  /** Empty when nothing is pinned — the caller falls back to the default ordering. */
  items: FeaturedRepo[];
  /** True when the pin store is configured (D1 binding present). */
  configured: boolean;
  fetched_at: string;
}

// ---------------------------------------------------------------------------
// Guards (used by the browser client before trusting a payload)
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function hasArray(value: unknown, key: string): boolean {
  return isRecord(value) && Array.isArray((value as Record<string, unknown>)[key]);
}

export function isContributorsResponse(value: unknown): value is ContributorsResponse {
  return hasArray(value, 'contributors') && typeof (value as Raw).has_next === 'boolean';
}

export function isLanguagesResponse(value: unknown): value is LanguagesResponse {
  return hasArray(value, 'languages') && typeof (value as Raw).total_bytes === 'number';
}

export function isReleasesResponse(value: unknown): value is ReleasesResponse {
  return hasArray(value, 'releases') && typeof (value as Raw).has_next === 'boolean';
}

export function isWorkflowsResponse(value: unknown): value is WorkflowsResponse {
  return hasArray(value, 'workflows') && typeof (value as Raw).total_count === 'number';
}

export function isWorkflowRunsResponse(value: unknown): value is WorkflowRunsResponse {
  return hasArray(value, 'runs') && typeof (value as Raw).total_count === 'number';
}

export function isRepoDocsResponse(value: unknown): value is RepoDocsResponse {
  return hasArray(value, 'docs') && typeof (value as Raw).commit_sha === 'string';
}

export function isRepoDocResponse(value: unknown): value is RepoDocResponse {
  return isRecord(value) && typeof value.kind === 'string' && typeof value.key === 'string';
}

export function isFeaturedReposResponse(value: unknown): value is FeaturedReposResponse {
  return hasArray(value, 'items') && typeof (value as Raw).configured === 'boolean';
}

/** Percentage breakdown of raw `name → bytes` language data. */
export function computeLanguageStats(raw: Record<string, number>): { totalBytes: number; languages: LanguageStat[] } {
  const entries = Object.entries(raw)
    .filter(([name, bytes]) => name.length > 0 && name.length <= 100 && Number.isFinite(bytes) && bytes >= 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

  const totalBytes = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  const languages = entries.map(([name, bytes]) => ({
    name,
    bytes,
    percent: totalBytes === 0 ? 0 : Math.round((bytes / totalBytes) * 1000) / 10,
  }));
  return { totalBytes, languages };
}
