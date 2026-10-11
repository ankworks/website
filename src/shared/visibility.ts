/**
 * Repository visibility rules for Forge itself.
 *
 * The owner does not want visitors browsing the implementation source of Forge
 * (the `ankworks/website` repository) *through Forge*. This module is the single
 * place that rule is expressed, and it is enforced on the server: a filtered
 * listing is a courtesy, the 404 is the rule.
 *
 * IMPORTANT LIMITATION (must stay documented everywhere this is used):
 * `ankworks/website` is a PUBLIC GitHub repository. Hiding it here does not
 * make it private and does not remove it from GitHub — the source is still
 * reachable directly on github.com and through the git remote. This is a
 * Forge-side presentation rule, not a confidentiality control. Real source
 * confidentiality requires moving the code to a private repository and
 * revisiting the deployment architecture.
 *
 * Which repository is hidden is deployment configuration (`FORGE_SELF_REPO`),
 * not a hardcoded constant, so a self-hosted or forked deployment is not
 * forced to hide a repository it does not have.
 */

/** Worker environment variable naming the repository Forge hides from itself. */
export const FORGE_SELF_REPO_VAR = 'FORGE_SELF_REPO';

/**
 * Parse the configured hidden repository names.
 *
 * Comma separated, trimmed, lower-cased; empty entries and duplicates are
 * dropped. GitHub repository names are case-insensitive.
 */
export function parseHiddenRepos(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const name = entry.trim().toLowerCase();
    if (name !== '' && !seen.has(name)) seen.add(name);
  }
  return [...seen];
}

/** True when a repository must not be served by Forge. */
export function isHiddenRepo(repo: string | null | undefined, hidden: readonly string[]): boolean {
  if (!repo) return false;
  if (hidden.length === 0) return false;
  return hidden.includes(repo.trim().toLowerCase());
}

/** Drop hidden repositories from a listing. */
export function filterHiddenRepos<T extends { name: string }>(repos: T[], hidden: readonly string[]): T[] {
  if (hidden.length === 0) return repos;
  return repos.filter((repo) => !isHiddenRepo(repo.name, hidden));
}
