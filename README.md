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
- **Cloudflare Pages** - Static site hosting
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

- Node.js 18+ 
- npm 9+
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/ankworks/website.git
cd website

# Install dependencies
npm ci

# Start development server
npm run dev
```

The development server will start at `http://localhost:3000`

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix ESLint issues |
| `npm run test` | Run tests |
| `npm run test:coverage` | Run tests with coverage |
| `npm run preview` | Preview production build |
| `npm run deploy` | Build and deploy to Cloudflare |

## 🔧 GitHub API Integration

The website fetches repository data from the GitHub REST API using the following endpoint:

```
GET https://api.github.com/orgs/ankworks/repos
```

### Features

- **Caching**: Repository data is cached for 5 minutes to reduce API calls
- **Pagination**: Automatically handles pagination for organizations with many repositories
- **Rate Limiting**: Respects GitHub's rate limits and handles errors gracefully
- **Data Normalization**: Normalizes GitHub API responses to consistent types
- **Fork Filtering**: Excludes forks by default with option to include them

### Environment Variables

Optional environment variables for the Cloudflare Worker:

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_TOKEN` | GitHub personal access token | No |

If `GITHUB_TOKEN` is provided as a Worker secret, it will be used for authenticated requests, which provides a higher rate limit.

**Note**: Never commit tokens to Git. Use Cloudflare Worker secrets:

```bash
# Set secret using Wrangler
npx wrangler secret put GITHUB_TOKEN
```

## ☁️ Cloudflare Deployment

### Prerequisites

- Cloudflare account
- Wrangler CLI installed (`npm install -g wrangler`)
- Cloudflare API token with Pages permissions

### Configuration

1. Update `wrangler.jsonc` with your Cloudflare configuration:

```json
{
  "name": "ankworks-website",
  "pages_build_output_dir": ".vite/deploy",
  "compatibility_date": "2024-01-01"
}
```

2. Authenticate with Cloudflare:

```bash
npx wrangler login
```

3. Deploy to Cloudflare Pages:

```bash
npm run deploy
```

### Custom Domain

To configure a custom domain:

1. In Cloudflare Dashboard, go to Pages
2. Select your project
3. Navigate to "Custom domains"
4. Add your domain (e.g., `works.ankb.qzz.io`)
5. Configure DNS records as instructed

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

- **Static Generation**: Pre-rendered pages for fast loading
- **Code Splitting**: Automatic code splitting with Vite
- **Lazy Loading**: Images and components loaded as needed
- **Efficient API**: Cached GitHub API responses
- **Minimal Dependencies**: Only essential libraries used
- **Optimized Assets**: Compressed and optimized static assets

**Target Scores**:
- Lighthouse Performance: ≥ 90
- Lighthouse Accessibility: ≥ 90

## 🔒 Security

Security best practices implemented:

- **Safe External Links**: All external links use `rel="noopener noreferrer"`
- **Input Validation**: All user inputs are validated
- **URL Validation**: External URLs are validated before use
- **No HTML Injection**: No dangerous HTML injection vulnerabilities
- **No Exposed Secrets**: API tokens are never exposed in client code
- **Security Headers**: Appropriate security headers configured
- **Content Security Policy**: Sensible CSP for modern web applications

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
