# AnkWorks Official Website

![AnkWorks Logo](https://avatars.githubusercontent.com/u/340385619)

**AnkWorks — Independent Software Development Portal**

The official website for AnkWorks, an independent software development organization focused on building open-source projects, developer tools, and experimental software.

## 🌐 Production

- **Production URL**: [https://works.ankb.qzz.io](https://works.ankb.qzz.io)
- **GitHub Organization**: [https://github.com/ankworks](https://github.com/ankworks)

## 🛠️ Technology Stack

### Frontend
- **React 18** - Component-based UI library
- **TypeScript** - Type-safe JavaScript
- **Vite** - Fast build tool and development server
- **Tailwind CSS** - Utility-first CSS framework
- **React Router DOM** - Client-side routing
- **Framer Motion** - Smooth animations

### Backend
- **Cloudflare Workers** - Serverless functions at the edge
- **TypeScript** - Type-safe Worker code

### Deployment
- **Cloudflare Workers** with Workers Static Assets (Wrangler 4)
- **Cloudflare Workers** - API routing
- **Wrangler** - Cloudflare deployment tool

### External APIs
- **GitHub REST API** - Repository data fetching

## 📁 Project Structure

```
ankworks-website/
├── public/                    # Static assets
│   ├── robots.txt            # SEO robots configuration
│   ├── sitemap.xml           # SEO sitemap
│   └── favicon.svg           # Website favicon
│
├── src/
│   ├── api/                  # API client and data fetching
│   │   └── github.ts         # GitHub API integration
│   │
│   ├── components/           # React components
│   │   ├── About.tsx         # About section
│   │   ├── Footer.tsx        # Footer component
│   │   ├── Hero.tsx          # Hero section
│   │   ├── Layout.tsx        # Page layout
│   │   ├── Navigation.tsx    # Navigation bar
│   │   ├── ProjectCard.tsx   # Repository card
│   │   ├── ProjectExplorer.tsx # Project grid
│   │   └── Stats.tsx         # Organization statistics
│   │
│   ├── hooks/                # Custom React hooks
│   │   ├── index.ts          # Hook exports
│   │   ├── useRepos.ts       # Repository data hook
│   │   └── useStats.ts       # Statistics hook
│   │
│   ├── pages/                # Page components
│   ├── shared/               # Repository sanitization shared by Worker and browser
│   │   ├── About.tsx         # About page
│   │   ├── Home.tsx          # Home page
│   │   └── Projects.tsx      # Projects page
│   │
│   ├── styles/               # Global styles
│   │   └── index.css         # Tailwind and custom styles
│   │
│   ├── test/                 # Test files
│   │   ├── components.test.tsx # Component tests
│   │   ├── github.test.ts    # GitHub API tests
│   │   └── setup.ts          # Test setup
│   │
│   ├── types/                # TypeScript types
│   │   └── index.ts          # Type definitions
│   │
│   ├── worker/               # Cloudflare Worker
│   │   └── api.ts           # API endpoint handler
│   │
│   ├── main.tsx              # Application entry
│   └── vite-env.d.ts         # Vite type declarations
│
├── .eslintrc.json            # ESLint configuration
├── .gitignore                # Git ignore rules
├── index.html               # HTML entry point
├── package.json             # Project dependencies
├── postcss.config.js        # PostCSS configuration
├── tailwind.config.js       # Tailwind configuration
├── tsconfig.json            # TypeScript configuration
├── vite.config.ts           # Vite configuration
├── vitest.config.ts         # Vitest configuration
└── wrangler.jsonc           # Cloudflare Worker configuration
```

## 🚀 Getting Started

### Prerequisites

- Node.js 22 or newer (tested with Node.js 24.21.0)
- npm 10+
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/ankworks/website.git
cd website

# Clean, reproducible install from the lockfile
npm ci

# Start the frontend dev server (http://localhost:3000)
npm run dev
```

The `/api/*` routes are served by the Worker. To exercise them during development, run the Worker in a second terminal:

```bash
npm run worker:dev   # builds dist/ and runs wrangler dev on http://127.0.0.1:8787
```

The Vite dev server proxies `/api` requests to that port.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server for the frontend (proxies `/api` to port 8787) |
| `npm run worker:dev` | Build, then run the Worker locally with Wrangler on port 8787 |
| `npm run build` | Production build into `dist/` |
| `npm run typecheck` | TypeScript checks for the app, the Worker, and the Vite config |
| `npm run lint` | ESLint (zero warnings allowed) |
| `npm run test` | Vitest suite (GitHub API is always mocked) |
| `npm run test:coverage` | Tests with coverage |
| `npm run preview` | Preview the production build with Vite |
| `npm run deploy` | Build, then `wrangler deploy` to Cloudflare (requires authentication) |

## 🔧 GitHub API Integration

The browser never calls GitHub directly. It calls the Worker endpoint:

```
GET /api/repos
```

The Worker fetches public repositories of the `ankworks` organization from the GitHub REST API:

```
GET https://api.github.com/orgs/ankworks/repos?type=public&per_page=100&page=N
```

### Behavior

- **Public only**: requests use `type=public`, and any item with `private: true` is dropped.
- **Pagination**: follows the `Link: rel="next"` header until there are no more pages. No repository count is assumed. A safety ceiling of 30 pages returns an explicit error instead of partial data.
- **Pagination link validation**: only links to `api.github.com` for this organization are followed.
- **Timeouts**: each upstream request is aborted after 8 seconds (`504 GITHUB_TIMEOUT`).
- **Rate limits**: a rate-limited upstream response becomes `429 GITHUB_RATE_LIMITED` with a `Retry-After` header.
- **Other errors**: `404 ORG_NOT_FOUND`, `502 GITHUB_UNAVAILABLE`, `502 GITHUB_UNREACHABLE`, `502 INVALID_UPSTREAM_RESPONSE`. Error responses are never cached and contain no upstream secrets.
- **Sanitization**: each repository is copied field by field. Only `https://github.com/` links are accepted. Descriptions are truncated and topics are capped.
- **Caching**: successful responses are cached for 5 minutes via `caches.default` (`Cache-Control: public, max-age=300`). The cache key ignores query strings. `X-Cache: HIT|MISS` indicates the cache state.
- **Partial failures**: if any page fails, the whole request fails. The API never returns a partial list as if it were complete.

Response shape:

```json
{
  "org": "ankworks",
  "repos": [{ "id": 1, "name": "website", "full_name": "ankworks/website", "...": "..." }],
  "total_count": 1,
  "fetched_at": "2026-10-10T00:00:00.000Z"
}
```

### Environment Variables

| Variable | Where | Description | Required |
|----------|-------|-------------|----------|
| `GITHUB_TOKEN` | Worker secret | Optional GitHub token for higher rate limits. Sent only to `api.github.com`, never returned to clients | No |
| `ASSETS` | Binding (set by `wrangler.jsonc`) | Workers Static Assets binding | Automatic |

Set the secret with Wrangler. Never commit tokens, and never put them in `.env` files that are committed:

```bash
npx wrangler secret put GITHUB_TOKEN
```

Only the public repositories of the organization are ever displayed, even when a token with wider access is configured.

## ☁️ Cloudflare Deployment

The site is deployed as a single Worker (`ankworks-website`) using **Workers Static Assets** with Wrangler 4.

### How it is wired

| Concern | Configuration |
|---------|---------------|
| Worker entry | `main: src/worker/index.ts` |
| Static files | `assets.directory: ./dist` (the Vite output, see `vite.config.ts` → `build.outDir`) |
| Binding | `assets.binding: ASSETS` (used for every non-API request) |
| API routing | `assets.run_worker_first: ["/api", "/api/*"]` so `/api/*` always reaches the Worker |
| SPA routes | `assets.not_found_handling: single-page-application` serves `index.html` for `/projects`, `/about`, etc. |
| Security headers and CSP | `public/_headers` (copied to `dist/` and applied to static asset responses) |
| Custom domain | `routes: [{ pattern: "works.ankb.qzz.io", custom_domain: true }]` |

The legacy `__STATIC_CONTENT` mechanism and Pages settings (`pages_build_output_dir`) are not used.

### Deploy

```bash
npm ci
npm run typecheck && npm run lint && npm run test
npm run deploy        # vite build, then wrangler deploy
```

Authenticate first with `npx wrangler login`, or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the CI environment. The token needs Workers Scripts edit permission and, for the custom domain, Zone DNS and Workers Routes permission on the `ankb.qzz.io` zone.

To validate the bundle and configuration without deploying:

```bash
npx wrangler deploy --dry-run --outdir .wrangler/dry-run
```

### Cloudflare Git integration (Workers Builds)

If the repository is connected through the Cloudflare dashboard:

- The Worker name in the dashboard must be `ankworks-website`, matching `name` in `wrangler.jsonc`. A mismatch (for example a project named `github`) makes the deploy target a different Worker.
- Build command: `npm ci && npm run build`. Deploy command: `npx wrangler deploy`.
- Node.js version: 22 or 24.

### Custom Domain

`works.ankb.qzz.io` is declared in `wrangler.jsonc`. For it to work:

1. The `ankb.qzz.io` zone must exist in the same Cloudflare account as the Worker.
2. No other Worker or DNS record may already use `works.ankb.qzz.io`.
3. Deploying the Worker attaches the custom domain automatically.

## 🎨 Design System

## 🎨 Design System

### Color Palette

| Name | Hex | Usage |
|------|-----|-------|
| Background | `#09090B` | Page background |
| Primary | `#A3E635` | Primary actions, accents |
| Surface | `#18181B` | Card backgrounds |
| Border | `#27272A` | Borders, dividers |
| Text | `#FAFAFA` | Primary text |

### Typography

- **Font Family**: Inter (sans-serif), JetBrains Mono (monospace)
- **Base Size**: 16px
- **Line Height**: 1.5

### Design Principles

- **Minimal**: Clean, uncluttered interfaces
- **Modern**: Contemporary design patterns
- **Developer-focused**: Built for technical audiences
- **Elegant**: Thoughtful spacing and typography
- **Professional**: Polished, production-ready appearance

### UI Features

- **Glassmorphism**: Subtle glass effects on cards and surfaces
- **Animations**: Smooth, reduced-motion compatible animations
- **Responsive**: Works on all screen sizes
- **Accessible**: Focus states, keyboard navigation, screen reader support

## ✅ SEO

The website includes comprehensive SEO features:

- **Semantic HTML**: Proper use of heading hierarchy and semantic elements
- **Meta Tags**: Description, keywords, author, viewport
- **Open Graph**: Social media sharing metadata
- **Twitter Cards**: Twitter-specific metadata
- **Canonical URL**: Prevents duplicate content issues
- **robots.txt**: Search engine crawling instructions
- **sitemap.xml**: Complete site map for search engines
- **Favicon**: Multiple favicon formats for all devices

## 🧪 Testing

Tests are written using Vitest with React Testing Library.

### Test Coverage

- GitHub API response normalization
- Repository sorting (stars, updated, name, forks)
- Repository filtering (language, search, forks)
- Language filtering
- API failure handling
- Empty repository lists
- Public repository filtering
- Fork filtering
- Basic React rendering
- Component accessibility

### Running Tests

```bash
# Run all tests
npm run test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test -- --watch
```

## 📊 Performance

The website is optimized for performance:

- **Code Splitting**: Vendor code is split into its own chunk with Vite
- **Edge Caching**: `/api/repos` responses are cached for 5 minutes
- **Minimal Dependencies**: Runtime dependencies are React, React Router, and Framer Motion

**Targets** (goals, not measured results): Lighthouse Performance ≥ 90, Accessibility ≥ 90. No Lighthouse run has been recorded for this repository yet.

## 🔒 Security

Security best practices implemented:

- **Safe External Links**: All external links use `rel="noopener noreferrer"`
- **Input Validation**: All user inputs are validated
- **URL Validation**: External URLs are validated before use
- **No HTML Injection**: No dangerous HTML injection vulnerabilities
- **No Exposed Secrets**: API tokens are never exposed in client code
- **Security Headers**: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Strict-Transport-Security` (see `public/_headers`)
- **Content Security Policy**: `script-src 'self'`; `style-src` allows Google Fonts and inline styles (required by React/Framer Motion); `img-src` allows GitHub avatars; `frame-ancestors 'none'`
- **No Third-Party Scripts**: no analytics or tracking scripts are loaded

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

### Code Style

- **TypeScript**: Strict mode enabled
- **ESLint**: Follows recommended rules
- **Prettier**: Consistent formatting (not configured yet, consider adding)
- **Naming**: Descriptive, camelCase for variables and functions, PascalCase for types and components

### Commit Messages

Use descriptive commit messages in English:

```
feat: add project search functionality
fix: resolve mobile navigation bug
chore: update dependencies
docs: update README with deployment instructions
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Inspired by modern developer portals
- Built with open-source technologies
- Designed for the developer community

## 📞 Contact

- **Email**: admin@ankb.qzz.io
- **GitHub**: [https://github.com/ankworks](https://github.com/ankworks)
- **Website**: [https://works.ankb.qzz.io](https://works.ankb.qzz.io)

---

Made with ❤️ by AnkWorks
