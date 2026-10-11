/**
 * Featured (pinned) repositories (V3-A / V3-E).
 *
 *   GET    /api/featured               public list of pinned repository names
 *   POST   /api/admin/featured         pin (or reposition) a repository — admin only
 *   POST   /api/admin/featured/order   reorder the pins — admin only
 *   DELETE /api/admin/featured/:repo   unpin — admin only
 *
 * Rules:
 * - Reads are public and cacheable: they only ever contain repository NAMES that
 *   already exist as public AnkWorks repositories. No statistics are stored or
 *   invented here — the dashboard renders real data from the repositories API.
 * - Mutations are admin-only (verified organization membership + explicit Forge
 *   admin authorization), require a same-origin request, and are audited.
 * - When D1 is not configured the read endpoint returns `configured: false`
 *   with an empty list so the UI falls back to the default ordering instead of
 *   showing a broken section.
 */

import { isValidRepoName, ORG_NAME } from '../shared/validation';
import { isHiddenRepo, parseHiddenRepos } from '../shared/visibility';
import type { FeaturedRepo } from '../shared/insights';
import type { Env } from './env';
import { cacheKeyFor, serveCached } from './cache';
import { UpstreamError, buildGitHubUrl, errorResponse, githubGet, readJson, repoApiPath } from './github-client';
import { sanitizeRepositoryDetail } from './sanitize';
import { isSameOrigin, privateJson, readJsonBody } from './http';
import { logEvent } from './logging';
import { requireForgeAdmin, verifyMembership } from './membership';
import { readSession, type SessionPayload } from './auth';

export interface FeaturedRow {
  repo: string;
  position: number;
  added_at: string;
  added_by: number | null;
}

/** Maximum number of pinned repositories. Keeps the dashboard readable. */
export const MAX_FEATURED = 12;

function featuredConfigured(env: Env): boolean {
  return Boolean(env.DB);
}

function notConfigured(): Response {
  return errorResponse(
    503,
    'FEATURED_NOT_CONFIGURED',
    'Repository pinning is not enabled on this deployment (needs the D1 binding).'
  );
}

/** Public read. Shared cache is safe: the payload contains only public names. */
export async function handleFeaturedList(
  request: Request,
  env: Env,
  ctx?: ExecutionContext
): Promise<Response> {
  if (!featuredConfigured(env)) {
    return privateJson({
      items: [],
      configured: false,
      fetched_at: new Date().toISOString(),
    });
  }

  const key = cacheKeyFor(new URL(request.url).origin, '/api/featured');
  return serveCached(key, ctx, async () => {
    const rows = await (env.DB as D1Database)
      .prepare('SELECT repo, position FROM featured_repos ORDER BY position ASC, repo ASC LIMIT ?1')
      .bind(MAX_FEATURED)
      .all<FeaturedRow>();
    const hidden = parseHiddenRepos(env.FORGE_SELF_REPO);
    const items: FeaturedRepo[] = (rows.results ?? [])
      .filter((row) => isValidRepoName(row.repo))
      // Visibility rule: a hidden repository can never be pinned, even if a row
      // for it exists in D1.
      .filter((row) => !isHiddenRepo(row.repo, hidden))
      .map((row, index) => ({ repo: row.repo, position: row.position ?? index }));
    return new Response(
      JSON.stringify({ items, configured: true, fetched_at: new Date().toISOString() }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=300, s-maxage=300',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
          'Referrer-Policy': 'no-referrer',
          'Cross-Origin-Resource-Policy': 'same-origin',
        },
      }
    );
  });
}

/**
 * Best-effort check that the repository really is a public AnkWorks repository.
 *
 * Returns true/false when GitHub answered, or null when it did not — a pinned
 * name that GitHub could not confirm is still accepted, because pinning stores
 * no data of its own and an unavailable upstream must not block an admin.
 */
async function repositoryExists(env: Env, repo: string): Promise<boolean | null> {
  try {
    const response = await githubGet(buildGitHubUrl(repoApiPath(repo)), env, {
      notFound: { code: 'UNKNOWN_REPOSITORY', message: 'Repository not found.' },
    });
    return sanitizeRepositoryDetail(await readJson(response), repo) !== null;
  } catch (error) {
    if (error instanceof UpstreamError && (error.status === 404 || error.status === 451)) return false;
    logEvent('warn', 'featured_repo_verify_failed', {
      stage: 'featured',
      errorName: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

function invalidRepo(): Response {
  return errorResponse(400, 'INVALID_REPO', 'A valid AnkWorks repository name is required.');
}

/** POST /api/admin/featured — pin a repository (admin only). */
export async function handleFeaturedAdd(request: Request, env: Env): Promise<Response> {
  if (!featuredConfigured(env)) return notConfigured();
  const session = await readSession(request, env);
  const gate = await requireForgeAdmin(session, env);
  if (!gate.granted) return adminDenied(gate.status.state, gate.status.reason);
  if (!isSameOrigin(request)) return errorResponse(403, 'CSRF_FAILED', 'Cross-origin writes are not allowed.');

  const body = await readJsonBody(request);
  const repo = typeof body?.repo === 'string' ? body.repo.trim() : '';
  if (!isValidRepoName(repo)) return invalidRepo();

  const known = await repositoryExists(env, repo);
  if (known === false) {
    return errorResponse(400, 'UNKNOWN_REPOSITORY', `No public ${ORG_NAME} repository named "${repo}".`);
  }

  const db = env.DB as D1Database;
  const count = await db.prepare('SELECT COUNT(*) AS n FROM featured_repos').first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_FEATURED) {
    const existing = await db.prepare('SELECT 1 AS ok FROM featured_repos WHERE repo = ?1').bind(repo).first<{ ok: number }>();
    if (existing?.ok !== 1) {
      return errorResponse(409, 'FEATURED_LIMIT', `At most ${MAX_FEATURED} repositories can be pinned.`);
    }
  }

  const nextPosition = typeof body?.position === 'number' && Number.isSafeInteger(body.position)
    ? Math.max(0, Math.min(body.position, MAX_FEATURED * 2))
    : (count?.n ?? 0);

  await db
    .prepare(
      `INSERT INTO featured_repos (repo, position, added_by) VALUES (?1, ?2, ?3)
       ON CONFLICT(repo) DO UPDATE SET position = excluded.position`
    )
    .bind(repo, nextPosition, gate.status.id)
    .run();

  logEvent('debug', 'featured_pinned', { repo, position: nextPosition });
  return privateJson({ repo, position: nextPosition, status: 'pinned' });
}

/** POST /api/admin/featured/order — reorder pins (admin only). */
export async function handleFeaturedOrder(request: Request, env: Env): Promise<Response> {
  if (!featuredConfigured(env)) return notConfigured();
  const session = await readSession(request, env);
  const gate = await requireForgeAdmin(session, env);
  if (!gate.granted) return adminDenied(gate.status.state, gate.status.reason);
  if (!isSameOrigin(request)) return errorResponse(403, 'CSRF_FAILED', 'Cross-origin writes are not allowed.');

  const body = await readJsonBody(request);
  const repos = body?.repos;
  if (!Array.isArray(repos) || repos.length === 0 || repos.length > MAX_FEATURED) {
    return errorResponse(400, 'INVALID_PARAMETER', `repos must list 1 to ${MAX_FEATURED} repository names.`);
  }
  for (const entry of repos) {
    if (typeof entry !== 'string' || !isValidRepoName(entry)) return invalidRepo();
  }

  const db = env.DB as D1Database;
  const statements = repos.map((repo, index) =>
    db.prepare('UPDATE featured_repos SET position = ?2 WHERE repo = ?1').bind(repo, index)
  );
  await db.batch(statements);

  logEvent('debug', 'featured_reordered', { count: repos.length });
  return privateJson({ items: repos.map((repo, index) => ({ repo, position: index })) });
}

/** DELETE /api/admin/featured/:repo — unpin (admin only). */
export async function handleFeaturedRemove(repo: string, request: Request, env: Env): Promise<Response> {
  if (!featuredConfigured(env)) return notConfigured();
  const session = await readSession(request, env);
  const gate = await requireForgeAdmin(session, env);
  if (!gate.granted) return adminDenied(gate.status.state, gate.status.reason);
  if (!isSameOrigin(request)) return errorResponse(403, 'CSRF_FAILED', 'Cross-origin writes are not allowed.');

  let decoded = repo;
  try {
    decoded = decodeURIComponent(repo);
  } catch {
    return invalidRepo();
  }
  if (!isValidRepoName(decoded)) return invalidRepo();

  await (env.DB as D1Database).prepare('DELETE FROM featured_repos WHERE repo = ?1').bind(decoded).run();
  logEvent('debug', 'featured_unpinned', { repo: decoded });
  return privateJson({ repo: decoded, status: 'unpinned' });
}

function adminDenied(state: string, reason: string): Response {
  if (state === 'not-member') {
    return errorResponse(
      reason === 'unauthenticated' ? 401 : 403,
      reason === 'unauthenticated' ? 'UNAUTHENTICATED' : 'NOT_ORG_MEMBER',
      reason === 'unauthenticated'
        ? 'Sign in to use Forge administration.'
        : 'AnkWorks organization membership is required for Forge administration.'
    );
  }
  if (state === 'unverifiable') {
    return errorResponse(503, 'MEMBERSHIP_UNVERIFIABLE', 'AnkWorks membership could not be verified right now. Try again later.');
  }
  return errorResponse(403, 'FORBIDDEN', 'This account is not authorized for Forge administration.');
}

/** Routes under /api/admin/featured. Returns null when the path is not ours. */
export async function handleFeaturedAdminRoute(
  pathname: string,
  request: Request,
  env: Env
): Promise<Response | null> {
  if (pathname === '/api/admin/featured' && request.method === 'POST') {
    return handleFeaturedAdd(request, env);
  }
  if (pathname === '/api/admin/featured/order' && request.method === 'POST') {
    return handleFeaturedOrder(request, env);
  }
  const remove = /^\/api\/admin\/featured\/([^/]+)$/.exec(pathname);
  if (remove && request.method === 'DELETE') {
    return handleFeaturedRemove(remove[1] ?? '', request, env);
  }
  if (pathname.startsWith('/api/admin/featured')) {
    return errorResponse(404, 'NOT_FOUND', 'API endpoint not found.');
  }
  return null;
}

/** Signed-in user's membership + admin flags for the account menu. */
export async function handleMembershipRequest(
  request: Request,
  env: Env
): Promise<Response> {
  if (request.method !== 'GET') {
    const response = errorResponse(405, 'METHOD_NOT_ALLOWED', 'Only GET is supported.');
    response.headers.set('Allow', 'GET');
    return response;
  }
  const session: SessionPayload | null = await readSession(request, env);
  const status = await verifyMembership(session, env);
  return privateJson(status);
}

/** Guard helper reused by other write modules. Throws for unauthorized callers. */
export async function assertMemberWrite(session: SessionPayload | null, env: Env, action: string): Promise<void> {
  const status = await verifyMembership(session, env);
  if (!session) {
    throw new UpstreamError(401, 'UNAUTHENTICATED', 'Sign in to use collaboration features.');
  }
  if (status.state === 'not-member') {
    logEvent('warn', 'write_denied_not_member', { stage: 'authorization', action, login: session.user.login });
    throw new UpstreamError(403, 'NOT_ORG_MEMBER', 'Only verified AnkWorks organization members can do that.');
  }
  if (status.state === 'unverifiable') {
    logEvent('warn', 'write_denied_unverifiable', { stage: 'authorization', action, login: session.user.login });
    throw new UpstreamError(
      503,
      'MEMBERSHIP_UNVERIFIABLE',
      'AnkWorks membership could not be verified right now. Try again later.'
    );
  }
}
