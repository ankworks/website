# AnkWorks Repository Explorer

A read-only, GitHub-style explorer for the public repositories of the
[`ankworks`](https://github.com/ankworks) organization, served from
`https://works.ankb.qzz.io`.

The site lets visitors browse organization repositories, directories, source
files, README files, branches, and commit history without leaving the AnkWorks
domain for normal browsing. GitHub stays the source of truth: every page links
to the matching page on GitHub, and the explorer never writes to a repository.

## Features

- **Organization overview (`/`)**: public repositories with description, language, stars, forks, last update, archived state, and default branch. Search (press `/` to focus), sort, language filter, hide forks/archived, loading skeletons, empty and error states.
- **Repository home (`/repos/:repo`)**: repository metadata, the root directory, and the rendered README.
- **Directory explorer (`/repos/:repo/tree/:ref/*`)**: breadcrumbs, branch selector, folder/file icons, file sizes, last commit per path, directories before files, empty directories, truncated listings (warning shown), symlinks, submodules.
- **Source viewer (`/repos/:repo/blob/:ref/*`)**: line numbers with `#L12` anchors, lightweight syntax highlighting (26 languages, lazy-loaded), copy contents, copy permalink (pinned to the commit SHA), raw download, path, size, language detection, horizontal scrolling. Binary files, Git LFS pointers, files over 512 KB, symlinks, and submodules get explicit notices instead of content.
- **README rendering**: GitHub Flavored Markdown (headings with anchors, tables, code fences, images, relative links, task lists). Raw HTML is never rendered. Relative links navigate inside the explorer; relative images resolve to `raw.githubusercontent.com` at the same commit.
- **Commit history (`/repos/:repo/commits/:ref?page=N`)**: short SHA, title, author, date, GitHub commit link, page navigation driven by the URL.
- **About (`/about`)**: organization facts and a description of the explorer.

Routes work on direct navigation and refresh. Unknown addresses show a not-found page.

### Branch names with `/`

Git refs may contain `/` (for example `feature/login`). The ref is one URL
segment, encoded twice (`feature%252Flogin`). A single `%2F` is not safe: the
static-asset layer decodes it and redirects. The router decodes the first
layer, and `decodeRouteRef` (in `src/shared/routes.ts`) decodes the second.
Path segments inside a repository are encoded per segment, so `/` separators stay
unambiguous.

## Routes

| URL | Page |
| --- | --- |
| `/` | Organization overview and repository list |
| `/repos/:repo` | Repository home (root directory and README) |
| `/repos/:repo/tree/:ref/*` | Directory at a branch, tag, or commit |
| `/repos/:repo/blob/:ref/*` | Source file viewer |
| `/repos/:repo/commits/:ref` | Commit history (`?page=N`) |
| `/about` | About AnkWorks and this explorer |

## Worker API

All GitHub requests go through the Worker. The browser never calls
`api.github.com`. Every endpoint is read-only (`GET` only; other methods return
`405` with `Allow: GET`).

| Endpoint | Purpose | GitHub REST API used |
| --- | --- | --- |
| `GET /api/repos` | Public repositories of the organization (all pages) | `GET /orgs/ankworks/repos?type=public` |
| `GET /api/org` | Organization profile | `GET /orgs/ankworks` |
| `GET /api/repos/:repo` | Repository metadata | `GET /repos/ankworks/:repo` |
| `GET /api/repos/:repo/branches?page=N` | Branch list, paginated | `GET /repos/ankworks/:repo/branches` |
| `GET /api/repos/:repo/tree?ref=R&path=P` | Directory listing | commit resolve + `GET /repos/.../contents/:path?ref=SHA` |
| `GET /api/repos/:repo/last-commit?ref=R&path=P` | Latest commit touching a path | `GET /repos/.../commits?sha=&path=&per_page=1` |
| `GET /api/repos/:repo/file?ref=R&path=P` | File metadata and text content (size-limited) | commit resolve + contents API |
| `GET /api/repos/:repo/readme?ref=R` | Repository README | `GET /repos/.../readme?ref=SHA` |
| `GET /api/repos/:repo/raw?ref=R&path=P` | Raw file download (attachment) | contents API, raw media type |
| `GET /api/repos/:repo/commits?ref=R&page=N` | Commit history, paginated | `GET /repos/.../commits?sha=` |

Refs are resolved to a commit SHA first (`GET /repos/.../commits/{ref}`), and
all content is read at that SHA, so one page never mixes two revisions.

### Errors

Error bodies have the form `{ "error": CODE, "message": "...", "status": N }`.
Common codes: `INVALID_REPO`, `INVALID_REF`, `INVALID_PATH`, `MISSING_REF`,
`REPO_NOT_FOUND`, `REF_NOT_FOUND`, `PATH_NOT_FOUND`, `FILE_NOT_FOUND`,
`README_NOT_FOUND`, `NOT_A_DIRECTORY`, `IS_DIRECTORY`, `NOT_A_FILE`,
`FILE_TOO_LARGE` (413), `GITHUB_RATE_LIMITED` (429, with `Retry-After`),
`GITHUB_TIMEOUT` (504), `GITHUB_UNREACHABLE` / `GITHUB_UNAVAILABLE` /
`INVALID_UPSTREAM_RESPONSE` (502). Error responses are never cached.

### Caching

- Successful responses are stored in `caches.default` for 5 minutes (commit history: 2 minutes), and sent with `Cache-Control: public, max-age=...`.
- Only successful responses are cached.
- The browser keeps responses for 60 seconds (explorer) or 5 minutes (repository list) and de-duplicates in-flight requests.

## Security

- **Read-only**: GET only. No authentication, no write operations, no private repositories.
- **Scope**: only repositories of `ankworks` that are public. Repository names, refs, and paths are validated before any upstream call. Path traversal (`..`, `.`, empty segments, backslashes, control characters) is rejected. Pagination links are followed only when they point to this organization's repository list.
- **Upstream**: fixed origin (`https://api.github.com`), `redirect: 'error'`, 8-second timeout, bounded response sizes. No arbitrary URL proxying.
- **Content**: text is rendered as text. Markdown is rendered with `react-markdown` without raw HTML. Link destinations are restricted to `http(s)`, `mailto`, and internal routes; `javascript:`, `data:`, and other schemes are dropped. README images only load from the allowlisted hosts in `src/shared/markdown-links.ts` (`IMAGE_HOSTS`). Repository code is never executed.
- **Headers**: `public/_headers` sets a strict Content-Security-Policy (`script-src 'self'`, no third-party styles or fonts, `img-src` synchronized with `IMAGE_HOSTS` by a test), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and HSTS. API responses set their own restrictive headers. Raw downloads are served as `application/octet-stream` with `Content-Disposition: attachment` and a sandboxed CSP.
- **Secrets**: `GITHUB_TOKEN` is an optional Worker secret used only for upstream requests. It is never returned to clients.

## Architecture

```
src/
  App.tsx              route table (code-split pages)
  main.tsx             React entry point
  pages/               route-level pages
  components/          layout and explorer UI (src/components/explorer)
  api/                 browser clients for /api (cache, timeouts, error mapping)
  shared/              validation, route builders, link/image resolution, limits (used by UI and Worker)
  lib/                 formatting, filters, error copy, syntax highlighting helpers
  worker/              Cloudflare Worker: router, GitHub client, caching, sanitizers, explorer endpoints
  test/                Vitest suites (mocked upstream only)
public/                static assets, _headers (security headers), robots.txt, sitemap.xml
```

Stack: React 18, TypeScript, Vite 5, Tailwind CSS 3, React Router 7, react-markdown + remark-gfm, lowlight (highlight.js grammars), Cloudflare Workers with Static Assets (Wrangler 4).

## Development

Requirements: Node.js 20+ and npm.

```bash
npm ci                 # install from the lockfile
npm run dev            # Vite dev server on http://localhost:3000
npm run worker:dev     # build, then run the Worker locally with wrangler dev on :8787
```

The Vite dev server proxies `/api` to the local Worker on port 8787, so run
`npm run worker:dev` in a second terminal when working on data pages.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run typecheck` | TypeScript checks for the app, the Worker, and the Node tooling config |
| `npm run lint` | ESLint with zero warnings allowed |
| `npm run test` | Vitest suites. No test calls GitHub; upstream responses are mocked |
| `npm run build` | Production build into `dist/` (code-split) |
| `npx wrangler dev --port 8787` | Local Worker with static assets (after a build) |
| `npm run deploy` | Build, then `wrangler deploy` (requires Cloudflare authentication) |

## Configuration

| Name | Type | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | Worker secret (optional) | Raises GitHub API rate limits. Set with `npx wrangler secret put GITHUB_TOKEN`. Never commit it. |

`wrangler.jsonc` defines the Worker `github`, the `ASSETS` binding,
`not_found_handling: "single-page-application"`, and `run_worker_first` for
`/api` only. The custom domain is `works.ankb.qzz.io`. The Worker does not
overwrite other Workers in the account; deploy this one with its own name.

## Testing

`npm run test` runs 170 tests across these areas:

- Worker endpoints: listing, branch and commit pagination, tree/file/README/raw handling, LFS pointers, binary files, symlinks, submodules, oversized files, invalid repository names and paths, traversal, rate limits (429 with `Retry-After`), timeouts, upstream failures, token handling, and the `redirect: 'error'` / `api.github.com`-only guarantee.
- Shared logic: validation, route encoding round-trips, Markdown link and image resolution, CSP and image-allowlist consistency, no third-party assets.
- Markdown rendering: GFM output, sanitization, dangerous links, relative links and images.
- UI routes: organization list, search, error and retry, rate-limit copy, directory navigation, branch-with-slash routing, source viewer states, commit pagination, not-found, and that the browser never calls `api.github.com`.

## Known limitations

- Directory listings come from the GitHub contents API, which returns at most 1,000 entries per directory. Larger directories are shown with a warning.
- Files above 512 KB are not rendered in the viewer. Files above 10 MB are not available through the raw endpoint; use the GitHub link.
- Git LFS objects are not downloaded; LFS pointers are shown as pointers.
- Submodules and symlinks are shown as metadata; they are never followed.
- The syntax highlighter covers 26 languages; other files render as plain text.
- Unauthenticated GitHub API limits apply unless `GITHUB_TOKEN` is set. Rate-limited requests return a retry time.
- Live GitHub upstream behaviour was not exercised from the development sandbox (see the deployment notes in the pull request); the test suite covers it with mocks.
