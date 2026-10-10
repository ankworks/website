/**
 * Repository normalization shared by the Cloudflare Worker and the browser client.
 * Keep this module free of DOM and Workers-only APIs so it compiles in both targets.
 */
import type { Repository } from '../types';

const MAX_DESCRIPTION_LENGTH = 500;
const MAX_TOPICS = 20;
const GITHUB_REPO_URL_PREFIX = 'https://github.com/';

type UnknownRecord = Record<string, unknown>;

function toRecord(input: unknown): UnknownRecord {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as UnknownRecord)
    : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Lenient normalization: fills defaults for missing fields. */
export function normalizeRepository(input: unknown): Repository {
  const repo = toRecord(input);
  return {
    id: num(repo.id),
    name: str(repo.name),
    full_name: str(repo.full_name),
    description: str(repo.description) || null,
    html_url: str(repo.html_url),
    language: str(repo.language) || null,
    stargazers_count: num(repo.stargazers_count),
    forks_count: num(repo.forks_count),
    updated_at: str(repo.updated_at),
    created_at: str(repo.created_at),
    archived: repo.archived === true,
    fork: repo.fork === true,
    size: num(repo.size),
    open_issues_count: num(repo.open_issues_count),
    topics: Array.isArray(repo.topics)
      ? repo.topics.filter((t): t is string => typeof t === 'string')
      : [],
  };
}

/** Minimal structural check used by the normalization tests. */
export function isValidRepository(input: unknown): boolean {
  const repo = toRecord(input);
  return Boolean(
    input !== null &&
      typeof input === 'object' &&
      !Array.isArray(input) &&
      repo.id &&
      repo.name &&
      repo.full_name &&
      repo.html_url
  );
}

function asNonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function asIsoDate(value: unknown): string {
  if (typeof value !== 'string') return '';
  return Number.isNaN(Date.parse(value)) ? '' : value;
}

/**
 * Strict sanitization of an untrusted GitHub payload item.
 * Returns null for anything that is not a public, well-formed GitHub repository.
 * Only the fields the website needs are copied; nothing else is forwarded.
 */
export function sanitizeRepository(input: unknown): Repository | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;

  // Never expose private repositories, even if the token could see them.
  if (raw.private === true) return null;

  const id = asNonNegativeInt(raw.id);
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const fullName = typeof raw.full_name === 'string' ? raw.full_name.trim() : '';
  const htmlUrl = typeof raw.html_url === 'string' ? raw.html_url : '';

  if (id === 0 || name === '' || fullName === '') return null;
  // Only accept links that point to github.com over HTTPS.
  if (!htmlUrl.startsWith(GITHUB_REPO_URL_PREFIX)) return null;

  const description =
    typeof raw.description === 'string' && raw.description.trim() !== ''
      ? raw.description.slice(0, MAX_DESCRIPTION_LENGTH)
      : null;

  const language = typeof raw.language === 'string' && raw.language !== '' ? raw.language : null;

  const topics = Array.isArray(raw.topics)
    ? raw.topics.filter((t): t is string => typeof t === 'string').slice(0, MAX_TOPICS)
    : [];

  return {
    id,
    name,
    full_name: fullName,
    description,
    html_url: htmlUrl,
    language,
    stargazers_count: asNonNegativeInt(raw.stargazers_count),
    forks_count: asNonNegativeInt(raw.forks_count),
    updated_at: asIsoDate(raw.updated_at),
    created_at: asIsoDate(raw.created_at),
    archived: raw.archived === true,
    fork: raw.fork === true,
    size: asNonNegativeInt(raw.size),
    open_issues_count: asNonNegativeInt(raw.open_issues_count),
    topics,
  };
}
