/**
 * Link and image resolution for README rendering.
 *
 * - Relative links become explorer routes (blob/tree) pinned to the commit SHA.
 * - Relative images resolve to raw.githubusercontent.com at the same commit.
 * - External links must be http(s) or mailto. Anything else (javascript:, data:,
 *   file:, vbscript:, …) is dropped.
 * - External images must come from IMAGE_HOSTS; other hosts render as text links.
 */
import { ORG_NAME, normalizeRepoPath, encodePathSegments } from './validation';
import { blobPath, treePath } from './routes';

/** Hosts a README image may load from. Mirrored in public/_headers (img-src). */
export const IMAGE_HOSTS: readonly string[] = [
  'raw.githubusercontent.com',
  'avatars.githubusercontent.com',
  'user-images.githubusercontent.com',
  'private-user-images.githubusercontent.com',
  'objects.githubusercontent.com',
  'camo.githubusercontent.com',
  'github.com',
  'img.shields.io',
];

export type ResolvedLink =
  | { kind: 'internal'; to: string }
  | { kind: 'external'; href: string }
  | { kind: 'anchor'; href: string }
  | { kind: 'none' };

export interface LinkContext {
  repo: string;
  /** Commit SHA the README was rendered from (keeps links stable). */
  commitSha: string;
  /** Directory of the README within the repository ("" for the root). */
  baseDir: string;
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Join a base directory and a relative path, rejecting escapes above the repository root. */
function resolveRepoRelative(baseDir: string, relative: string): string | null {
  const decoded = safeDecode(relative);
  if (decoded === null) return null;
  const stack = baseDir === '' ? [] : baseDir.split('/');
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return normalizeRepoPath(stack.join('/'));
}

function stripQueryAndHash(href: string): { path: string; trailingSlash: boolean } {
  const withoutHash = href.split('#')[0];
  const withoutQuery = withoutHash.split('?')[0];
  return { path: withoutQuery, trailingSlash: withoutQuery.endsWith('/') };
}

/** Resolve a Markdown link destination. */
export function resolveMarkdownLink(href: string | null | undefined, context: LinkContext): ResolvedLink {
  if (!href) return { kind: 'none' };
  const value = href.trim();
  if (value === '') return { kind: 'none' };

  if (value.startsWith('#')) return { kind: 'anchor', href: value };

  if (value.startsWith('//')) {
    return isSafeExternal(`https:${value}`) ? { kind: 'external', href: `https:${value}` } : { kind: 'none' };
  }

  const scheme = SCHEME.exec(value);
  if (scheme) {
    return isSafeExternal(value) ? { kind: 'external', href: value } : { kind: 'none' };
  }

  const { path, trailingSlash } = stripQueryAndHash(value);
  const resolved = resolveRepoRelative(context.baseDir, path);
  if (resolved === null) return { kind: 'none' };

  if (resolved === '') {
    return { kind: 'internal', to: treePath(context.repo, context.commitSha) };
  }
  // A trailing slash signals a directory; otherwise the blob page redirects
  // to the tree view if the target turns out to be a directory.
  const to = trailingSlash
    ? treePath(context.repo, context.commitSha, resolved)
    : blobPath(context.repo, context.commitSha, resolved);
  return { kind: 'internal', to };
}

/** Resolve an image source. Returns null when the image must not be loaded. */
export function resolveMarkdownImage(src: string | null | undefined, context: LinkContext): string | null {
  if (!src) return null;
  const value = src.trim();
  if (value === '') return null;

  if (SCHEME.test(value) || value.startsWith('//')) {
    const absolute = value.startsWith('//') ? `https:${value}` : value;
    try {
      const url = new URL(absolute);
      if (url.protocol !== 'https:') return null;
      if (!IMAGE_HOSTS.includes(url.hostname)) return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  const { path } = stripQueryAndHash(value);
  const resolved = resolveRepoRelative(context.baseDir, path);
  if (resolved === null || resolved === '') return null;
  return `https://raw.githubusercontent.com/${ORG_NAME}/${encodeURIComponent(context.repo)}/${context.commitSha}/${encodePathSegments(resolved)}`;
}

function isSafeExternal(value: string): boolean {
  if (/^mailto:/i.test(value)) return value.length <= 2048;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && value.length <= 2048;
  } catch {
    return false;
  }
}
