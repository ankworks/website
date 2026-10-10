# AnkWorks Forge

AnkWorks Forge is a read-only development platform for the public repositories of the [`ankworks`](https://github.com/ankworks) organization, designed for the `works.ankb.qzz.io` domain. GitHub remains the source of truth. This repository is the existing AnkWorks Code Explorer, incrementally expanded rather than replaced; no production deployment is part of this change.

## Milestones

### Milestone A — Markdown platform

- **Markdown platform**: a sanitized GitHub-flavored Markdown renderer (tables, task lists, fenced code with syntax highlighting, safe raw-HTML subset), Mermaid diagrams (lazy-loaded, strict security, CSP-safe styling), GitHub-style heading anchors with duplicate suffixes, and a table of contents beside long documents.
- **Organization profile README**: `ankworks/.github/profile/README.md` rendered below the organization overview and featured projects, fetched live from GitHub with cache support and a graceful fallback when it is missing.
- **Markdown file viewer**: Preview / Source / Edit modes for every Markdown file. Preview renders the document with an outline; Source shows the original Markdown with highlighting and line numbers; Edit opens a local-draft split workspace (source + live preview) with unsaved-change warnings — saving to GitHub stays disabled until sign-in and authorized commits land.
- **Organization dashboard** with the official, locally hosted AnkWorks logo; live public repository, star, and fork totals; featured repositories ranked from current star counts; and recent public organization events.
- **Repository exploration** with searchable public repositories, source browsing, README rendering, branches, tags, and paginated commit history.
- **Issues** with organization-wide and repository-specific lists, open/closed/all filters, issue detail, labels, safe Markdown, comments, and pagination.
- **Pull requests** with organization-wide and repository-specific lists, state filters, detail and lifecycle status, labels, changed files, commits, conversation comments, review comments, and pagination.
- **Responsive navigation**, dark-first palette, light theme support, keyboard focus states, loading, empty, and error states.
- **Foundation** for the Forge experience: dark-first palette, dense Forge-style layout, responsive navigation.

### Milestone B — GitHub authentication and sessions
- **OAuth sign-in** (`/api/auth/login` → GitHub → `/api/auth/callback`) with CSRF `state` binding and a fail-closed callback.
- **Encrypted sessions**: the GitHub access token lives only inside an AES-256-GCM sealed `HttpOnly; Secure; SameSite=Lax` cookie — never in JS, URLs, or JSON. Tampered, expired, or foreign-key cookies are rejected.
- **Permission detection** (`GET /api/auth/permissions`) mapping repository roles (admin/maintain/write/triage/read) with the user's own token; account menu with sign-in/sign-out; guest mode when secrets are missing.

### Milestone C — Commits, branches, diff viewer
- **Authenticated writes**: `POST /api/repos/:repo/commit` (create/update a file) and `POST /api/repos/:repo/branches`, each requiring a session and verified push permission before touching GitHub (fail closed). The optional server `GITHUB_TOKEN` is never used for user writes.
- **Commit UI**: split workspace (source + live preview) with commit message, target branch (typing a new name creates it), and a gated commit button with truthful explanations.
- **Diff viewer** for `GET /api/repos/:repo/compare` (unified patches, add/delete rows, binary fallback).
- **CSP-safe editing surface**: the production CSP keeps `style-src 'self'`, which rules out Monaco/CodeMirror (runtime `<style>` injection). The editor is an accessible textarea with a line-number gutter; Monaco stays deferred until a dedicated CSP review.

### Milestone D — Collaboration writes
- **Issues**: create, comment, close/reopen, and label management (`POST /api/repos/:repo/issues`, `…/comments`, `PATCH …/issues/:number`).
- **Pull requests**: open PRs, submit reviews (COMMENT/APPROVE/REQUEST_CHANGES), and merge (merge/squash/rebase) with write-permission gating.
- Every collaboration control degrades to a truthful sign-in or permission gate instead of pretending to work.

### Milestone E — Guest issues with moderation
- **Guest submission** (`POST /api/guest/issues`): Cloudflare Turnstile verification, honeypot trap, per-client rate limiting on hashed IPs, and PENDING rows in D1. **Guest emails live only in D1** — never in responses, GitHub issues, or logs.
- **Moderation queue** (repository admins only): approve publishes the GitHub issue with the admin's own user token (never an installation token) and without the guest's email; reject discards it. Resend notification emails are best-effort.
- Feature is **off (503)** until the D1 binding and Turnstile secret exist — never half-open. Schema: `migrations/0001_guest_issues.sql`.

### Milestone F — Search, notifications, command palette, ops
- **Search** (`GET /api/search`): org-scoped GitHub search across code, issues/PRs, and repositories with a dedicated page.
- **Notifications** (`GET /api/notifications`) for signed-in users (their own token).
- **Command palette** (Ctrl/⌘-K) with quick navigation and search jump.
- **Ops hardening**: `X-Request-Id` on every API response with log correlation, and `GET /api/health` with in-isolate counters (no secrets or user data).

## Routes

| URL | Page |
| --- | --- |
| `/` | Organization dashboard and recent public activity |
| `/explore` | Popular and recently updated public repositories |
| `/repos` | Searchable repository index |
| `/issues` | Public AnkWorks issues across repositories |
| `/pulls` | Public AnkWorks pull requests across repositories |
| `/repos/:repo` | Repository home: source tree and README |
| `/repos/:repo/tree/:ref/*` | Directory listing at a branch, tag, or commit |
| `/repos/:repo/blob/:ref/*` | File viewer; Markdown files open in Preview / Source / Edit modes (`?view=preview\|source\|edit`) |
| `/repos/:repo/commits/:ref` | Paginated commit history |
| `/repos/:repo/branches` | Branches and tags (`?view=tags`) |
| `/repos/:repo/issues` | Repository issues; `/:number` opens issue details |
| `/repos/:repo/pulls` | Repository pull requests; `/:number` opens PR details |
| `/about` | Organization and platform information |

The repository navigation includes Code, Issues, Pull Requests, Commits, Branches, and Wiki. Wiki is linked to GitHub only when that repository has enabled a GitHub Wiki; no unsupported in-app Wiki page is fabricated.

Git refs can contain slashes. The ref is encoded as one route segment (double-encoded where required by Workers Static Assets), separately from the repository path. Ref values also travel in query parameters to the Worker API; they are never naively split on `/`.

## Worker API

The browser calls only same-origin `/api` routes. The Worker calls the GitHub REST API, sanitizes responses, and returns bounded JSON. Every route is read-only; non-GET requests return `405` with `Allow: GET`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/org` | Sanitized AnkWorks organization profile |
| `GET /api/org/profile-readme` | Organization profile README (`ankworks/.github` → `profile/README.md`, fixed path) |
| `GET /api/repos` | Public organization repositories, paginated upstream |
| `GET /api/activity?limit=N` | Recent public organization events |
| `GET /api/issues?state=&page=` | Organization-wide public issue search |
| `GET /api/pulls?state=&page=` | Organization-wide public pull-request search |
| `GET /api/repos/:repo` | Public repository metadata |
| `GET /api/repos/:repo/branches?page=` | Branches |
| `GET /api/repos/:repo/tags?page=` | Tags |
| `GET /api/repos/:repo/commits?ref=&page=` | Commit history |
| `GET /api/repos/:repo/issues?state=&page=` | Repository issues (pull requests excluded) |
| `GET /api/repos/:repo/issues/:number` | Issue details |
| `GET /api/repos/:repo/issues/:number/comments?page=` | Issue comments |
| `GET /api/repos/:repo/pulls?state=&page=` | Repository pull requests |
| `GET /api/repos/:repo/pulls/:number` | Pull-request details and lifecycle status |
| `GET /api/repos/:repo/pulls/:number/files?page=` | Changed files and bounded patches |
| `GET /api/repos/:repo/pulls/:number/commits?page=` | Pull-request commit history |
| `GET /api/repos/:repo/pulls/:number/comments?page=` | Pull-request conversation comments |
| `GET /api/repos/:repo/pulls/:number/review-comments?page=` | Review comments on changed files |
| `GET /api/repos/:repo/tree?ref=&path=` | Directory contents |
| `GET /api/repos/:repo/file?ref=&path=` | Bounded text-file contents and file metadata |
| `GET /api/repos/:repo/readme?ref=` | README contents |
| `GET /api/repos/:repo/raw?ref=&path=` | Bounded raw attachment |
| `GET /api/repos/:repo/last-commit?ref=&path=` | Latest commit touching a path |
| `GET /api/auth/login` · `GET /api/auth/callback` | OAuth sign-in flow |
| `GET /api/auth/session` · `POST /api/auth/logout` | Session state (never contains tokens) and sign-out |
| `GET /api/auth/permissions?owner=&repo=` | Permission detection for the signed-in user |
| `POST /api/repos/:repo/commit` | Commit one file to a branch (session + push) |
| `POST /api/repos/:repo/branches` | Create a branch (session + push) |
| `GET /api/repos/:repo/compare?base=&head=` | Unified diff between two refs |
| `POST /api/repos/:repo/issues` · `POST …/issues/:n/comments` | Create issue / comment (session) |
| `PATCH /api/repos/:repo/issues/:n` | Update title/state/labels (session + triage) |
| `POST /api/repos/:repo/pulls` · `POST …/pulls/:n/reviews` | Open PR / submit review (session) |
| `PUT /api/repos/:repo/pulls/:n/merge` | Merge a pull request (session + write) |
| `POST /api/guest/issues` · `GET /api/guest/config` | Guest submission (Turnstile + D1) and public config |
| `GET /api/admin/moderation` · `POST …/:id/approve|reject` | Moderation queue (repository admins) |
| `GET /api/search?q=&type=` | Org-scoped search (code, issues, repos) |
| `GET /api/notifications` | Signed-in user's notifications |
| `GET /api/health` | Liveness and coarse metrics |

Organization-wide Issues and Pull Requests use fixed GitHub Search API queries scoped to `org:ankworks`; no arbitrary GitHub API proxy is exposed. Public event and repository data are sanitized field by field. Issue and PR Markdown skips raw HTML, validates links, and does not fetch embedded images.

## Security and caching

- The Worker reads only public AnkWorks repositories. Repository visibility is checked live before every repository-scoped request and before consulting its data cache; private or malformed repositories fail closed. Organization-wide activity and issue/PR search always use anonymous GitHub requests, so `GITHUB_TOKEN` cannot reveal private activity or search results.
- Private repository content is never cached or served. Error responses use `Cache-Control: no-store`; successful repository data is cached only after public-repository validation.
- The upstream origin is fixed to `https://api.github.com`. Paths are limited to AnkWorks organization/repository resources plus the single fixed `/search/issues` endpoint. Search terms are constructed by the Worker, not accepted from a caller.
- Cloudflare workerd supports `redirect: 'manual'` and `redirect: 'follow'`, not `redirect: 'error'`. The GitHub client uses **`redirect: 'manual'`** and follows only bounded redirects whose targets remain inside its allowlist. Redirect bodies are discarded.
- Every upstream call has a timeout and bounded response reads. GitHub tokens, if configured, are sent upstream only and are never returned to the browser or written to logs.
- Markdown is rendered through remark-gfm → rehype-raw → rehype-sanitize with a GitHub-style allowlist: raw HTML reduces to a safe formatting subset (no scripts, no event handlers, no `style`, no unsafe URL schemes), heading `id`s are generated server-side-in-code from the document text, and every link/image is checked again by the shared host/protocol resolvers. Code is displayed as text and never executed.
- Mermaid fences render with `securityLevel: 'strict'` and `htmlLabels: false`; the SVG is scrubbed again (no script/foreignObject/iframe, no anchors, https-only URLs) and its styles are applied through the CSSOM so the `style-src 'self'` CSP keeps holding. Render failures fall back to the diagram source as text. The mermaid library is lazy-loaded and never part of the initial bundle.
- The organization profile README endpoint reads only the fixed `ankworks/.github` → `profile/README.md` path (never request input), verifies the repository is public before serving, and fails closed for private or foreign repositories.
- Static files use Workers Static Assets through the `ASSETS` binding and SPA fallback. `/api` routes continue through the existing Worker; no legacy `__STATIC_CONTENT` binding is used.

Successful public responses use short shared cache lifetimes (typically 60 seconds for collaboration data and activity, up to 5 minutes for stable repository metadata). The in-memory browser cache is also short-lived. Errors are not cached.

## Branding

Official AnkWorks organization branding is sourced from the GitHub organization avatar and stored locally in `public/branding/` so critical site branding does not depend on the GitHub avatar CDN at runtime. The optimized logo is used in the header, dashboard, About page, favicon, and social preview.

- `public/branding/ankworks-logo.png` — optimized official avatar
- `public/branding/ankworks-logo.webp` — optimized UI variant
- `public/branding/og-preview.png` — 1200×630 Open Graph/Twitter preview
- `public/favicon.ico`, `public/favicon-32x32.png`, `public/apple-touch-icon.png`, `public/favicon.svg` — browser icons

## Architecture

```
src/
  App.tsx                    React Router table and code-split pages
  pages/                     dashboard, repository, issue, PR, branch/tag, and About pages
  components/                navigation, theme, collaboration, and source explorer UI
  components/explorer/       Markdown renderer, TOC, Mermaid diagrams, Markdown editor (draft)
  api/explorer.ts            same-origin browser API client and response guards
  api/github.ts              public repository-list client
  shared/                    validation, route builders, limits, Markdown safety, TOC slugs, sanitize schema
  worker/api.ts              Worker routing, repository visibility checks, caching
  worker/collaboration.ts    public activity, issues, pull requests, tags, sanitizers
  worker/github-client.ts    fixed-origin, bounded GitHub REST client
  worker/explorer.ts         tree, file, README, and raw-file handlers
  test/                      mocked GitHub API, Worker, and route-level UI tests
public/                      static assets, local branding, and security headers
```

Stack: React 18, TypeScript, Vite 5, Tailwind CSS 3, React Router 7, react-markdown + remark-gfm, lowlight, and Cloudflare Workers with Static Assets (Wrangler 4).

## Development and verification

Requirements: Node.js 22+ and npm.

```bash
npm ci
npm run dev
npm run worker:dev
```

The Vite server proxies `/api` to the local Worker on port 8787. Run the Vite server and `npm run worker:dev` in separate terminals when testing the complete app. The Worker remains named `github`; Wrangler uses `ASSETS`, the current SPA fallback, and the existing production domain.

```bash
npm run typecheck
npm run lint
npm run test
npm run build
npx wrangler deploy --dry-run
```

Tests mock GitHub responses and do not require live credentials. They cover Worker routes and sanitization, fixed API origin/redirect handling, repository visibility, pagination, activity, tags, issues, pull requests, safe Markdown, and existing source-explorer behavior.

## Secrets and bindings

| Name | Used by | Required? |
| --- | --- | --- |
| `GITHUB_TOKEN` | Read-only upstream calls (rate limits) | Optional |
| `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | OAuth sign-in (B) | Optional — sign-in off without them |
| `SESSION_ENCRYPTION_KEY` (32+ chars) | Session cookie encryption (B) | Optional — sign-in off without it |
| `DB` (D1, `migrations/0001_guest_issues.sql`) | Guest issues (E) | Optional — guest form off without it |
| `TURNSTILE_SECRET_KEY` / `TURNSTILE_SITE_KEY` | Guest captcha (E) | Optional — guest form off without them |
| `RESEND_API_KEY` / `MODERATION_NOTIFY_EMAIL` | Moderation emails (E) | Optional (best-effort) |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` | Reserved for app-actor tasks | Not used for user writes |

## Known limitations

- Monaco/CodeMirror are not used: the production CSP (`style-src 'self'`) blocks their runtime style injection. The editing surface is a CSP-safe textarea with line numbers; adopting Monaco requires an explicit CSP decision.
- The Write API covers single-file commits; multi-file commits, delete/rename, and find-in-files remain future work.
- Setext headings (`Title
-----`) receive anchors but are not listed in the table of contents.
- GitHub Search API result counts and pagination inherit GitHub's search limits and rate limits. Public event data is a recent activity feed, not a complete audit log.
- A GitHub Wiki is opened on GitHub when enabled; wiki content is not rendered in Forge.
- Direct GitHub links remain available for details that are not implemented in the local UI. GitHub is authoritative for permissions, branch protection, rulesets, and collaboration state.
- The source explorer retains its existing file-size, directory-listing, binary-file, and Git LFS limits.
- Production deployment and live production-domain verification require the authorized Cloudflare workflow; this development work does not deploy the Worker.
