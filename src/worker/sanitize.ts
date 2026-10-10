/**
 * Field-by-field sanitization of GitHub payloads. Nothing upstream is forwarded
 * as-is: each value is type-checked, length-limited, and (for URLs) rebuilt from
 * validated parts or checked against an allowlist.
 */
import type {
  BranchInfo,
  CommitSummary,
  DirectoryEntry,
  EntryType,
  OrganizationInfo,
  RepositoryDetail,
} from '../types';
import type { TagInfo } from '../types/collaboration';
import { sanitizeRepository } from '../shared/repository';
import { ORG_NAME, encodePathSegments, isCommitSha, isValidRef, isValidRepoName } from '../shared/validation';

type Raw = Record<string, unknown>;

const MAX_MESSAGE_LENGTH = 4000;
const MAX_TITLE_LENGTH = 300;
const MAX_NAME_LENGTH = 255;
const MAX_URL_LENGTH = 2048;

function asRecord(value: unknown): Raw | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : null;
}

function asString(value: unknown, maxLength = MAX_NAME_LENGTH): string | null {
  return typeof value === 'string' && value.length <= maxLength ? value : null;
}

function asInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function asIsoDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  return Number.isNaN(Date.parse(value)) ? '' : value;
}

/**
 * Only https URLs without credentials are kept. When `hosts` is given, the host
 * must also be on that list.
 */
function asHttpsUrl(value: unknown, hosts?: readonly string[]): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (hosts && !hosts.includes(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Canonical github.com URL built from validated parts. */
export function githubUrl(repo: string, ...segments: string[]): string {
  const base = `https://github.com/${ORG_NAME}/${encodeURIComponent(repo)}`;
  return segments.length === 0 ? base : `${base}/${segments.join('/')}`;
}

/** Repository details. Returns null when the payload is not a public repository of the organization. */
export function sanitizeRepositoryDetail(input: unknown, requestedName: string): RepositoryDetail | null {
  const raw = asRecord(input);
  if (!raw || raw.private === true) return null;

  const base = sanitizeRepository(raw);
  if (!base) return null;

  const owner = asRecord(raw.owner);
  if (!owner || typeof owner.login !== 'string' || owner.login.toLowerCase() !== ORG_NAME) return null;
  if (base.full_name.toLowerCase() !== `${ORG_NAME}/${requestedName}`.toLowerCase()) return null;
  if (!isValidRepoName(base.name)) return null;

  const license = asRecord(raw.license);
  const licenseName = license ? asString(license.spdx_id, 64) ?? asString(license.name, 128) : null;

  return {
    ...base,
    pushed_at: asIsoDate(raw.pushed_at),
    license: licenseName && licenseName !== 'NOASSERTION' ? licenseName : null,
    homepage: asHttpsUrl(raw.homepage) ?? null,
    has_wiki: raw.has_wiki === true,
    has_issues: raw.has_issues === true,
  };
}

export function sanitizeOrganization(input: unknown): OrganizationInfo | null {
  const raw = asRecord(input);
  if (!raw || typeof raw.login !== 'string' || raw.login.toLowerCase() !== ORG_NAME) return null;

  // The organization profile may store the website without a scheme ("example.org").
  const blogRaw = typeof raw.blog === 'string' ? raw.blog.trim() : '';
  const blog = blogRaw === '' ? null : asHttpsUrl(/^https?:\/\//i.test(blogRaw) ? blogRaw : `https://${blogRaw}`);

  return {
    login: ORG_NAME,
    name: asString(raw.name, 255),
    description: asString(raw.description, 1000) || null,
    // Critical AnkWorks branding is served from this site's own static assets.
    avatar_url: '/branding/ankworks-logo.png',
    html_url: `https://github.com/${ORG_NAME}`,
    blog,
    location: asString(raw.location, 255) || null,
    public_repos: asInt(raw.public_repos),
    created_at: asIsoDate(raw.created_at),
  };
}

export function sanitizeBranch(input: unknown): BranchInfo | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const name = asString(raw.name, 255);
  const commit = asRecord(raw.commit);
  const sha = commit ? asString(commit.sha, 40) : null;
  if (!name || !isValidRef(name) || !sha || !isCommitSha(sha)) return null;
  return { name, sha, protected: raw.protected === true };
}

export function sanitizeTag(input: unknown): TagInfo | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const name = asString(raw.name, 255);
  const commit = asRecord(raw.commit);
  const sha = commit ? asString(commit.sha, 40) : null;
  if (!name || !isValidRef(name) || !sha || !isCommitSha(sha)) return null;
  return { name, sha };
}

/** Commit summary. `repo` is used to build the GitHub link. */
export function sanitizeCommit(input: unknown, repo: string): CommitSummary | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const sha = asString(raw.sha, 40);
  const commit = asRecord(raw.commit);
  if (!sha || !isCommitSha(sha) || !commit) return null;

  const message = (asString(commit.message, 100_000) ?? '').slice(0, MAX_MESSAGE_LENGTH);
  const title = (message.split('\n')[0] ?? '').slice(0, MAX_TITLE_LENGTH);
  const author = asRecord(commit.author);
  const committer = asRecord(commit.committer);
  const authorLogin = asRecord(raw.author);

  return {
    sha,
    title,
    message,
    author_name: (author && asString(author.name, 255)) || (authorLogin && asString(authorLogin.login, 255)) || 'Unknown',
    author_login: authorLogin && typeof authorLogin.login === 'string' ? asString(authorLogin.login, 255) : null,
    date: asIsoDate(committer?.date) || asIsoDate(author?.date),
    html_url: githubUrl(repo, 'commit', sha),
  };
}

const ENTRY_TYPES: readonly EntryType[] = ['file', 'dir', 'symlink', 'submodule'];

/** Directory entry. `ref` is the commit SHA the listing was read from. */
export function sanitizeEntry(input: unknown, repo: string, ref: string): DirectoryEntry | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const type = raw.type as EntryType;
  if (!ENTRY_TYPES.includes(type)) return null;
  const name = asString(raw.name, 255);
  const path = asString(raw.path, 1024);
  const sha = asString(raw.sha, 40);
  if (!name || !path || !sha || name === '.' || name === '..' || name.includes('/')) return null;

  const kind = type === 'dir' ? 'tree' : 'blob';
  return {
    name,
    path,
    type,
    size: type === 'file' ? asInt(raw.size) : 0,
    sha,
    html_url: githubUrl(repo, kind, encodeURIComponent(ref), encodePathSegments(path)),
  };
}

/** Directories (and submodules) first, then files and symlinks; each group by name. */
export function sortEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  const rank = (entry: DirectoryEntry) => (entry.type === 'dir' || entry.type === 'submodule' ? 0 : 1);
  return [...entries].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.name < b.name ? -1 : 1);
  });
}

/** Contents API object for a single path (file, symlink, or submodule). */
export interface ContentsObject {
  type: EntryType;
  name: string;
  path: string;
  sha: string;
  size: number;
  content: string | null;
  encoding: string | null;
  target: string | null;
  submodule_url: string | null;
}

export function sanitizeContentsObject(input: unknown): ContentsObject | null {
  const raw = asRecord(input);
  if (!raw) return null;
  const type = raw.type as EntryType;
  if (!ENTRY_TYPES.includes(type)) return null;
  const name = asString(raw.name, 255);
  const path = asString(raw.path, 1024);
  const sha = asString(raw.sha, 40);
  if (!name || !path || !sha) return null;

  const content = typeof raw.content === 'string' ? raw.content : null;
  const encoding = typeof raw.encoding === 'string' ? raw.encoding : null;
  return {
    type,
    name,
    path,
    sha,
    size: asInt(raw.size),
    content,
    encoding,
    target: type === 'symlink' ? asString(raw.target, 1024) : null,
    submodule_url: type === 'submodule' ? asHttpsUrl(raw.submodule_git_url, ['github.com']) : null,
  };
}
