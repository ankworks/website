import { Link, NavLink } from 'react-router-dom';
import { ExternalLink } from './explorer/ui';

const GITHUB_ORG_URL = 'https://github.com/ankworks';

export default function Navigation() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:ring-2 focus-visible:ring-primary/60">
          <img src="/favicon.svg" alt="" width={24} height={24} className="h-6 w-6 rounded-md" />
          <span className="font-semibold text-text">AnkWorks</span>
          <span className="hidden text-muted sm:inline">/ explorer</span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `rounded-md px-2.5 py-1.5 text-sm transition-colors ${isActive ? 'bg-elevated text-text' : 'text-muted hover:text-text'}`
            }
          >
            Repositories
          </NavLink>
          <NavLink
            to="/about"
            className={({ isActive }) =>
              `rounded-md px-2.5 py-1.5 text-sm transition-colors ${isActive ? 'bg-elevated text-text' : 'text-muted hover:text-text'}`
            }
          >
            About
          </NavLink>
        </nav>

        <div className="ml-auto">
          <ExternalLink href={GITHUB_ORG_URL} className="rounded-md px-2 py-1.5 text-sm">
            GitHub
          </ExternalLink>
        </div>
      </div>
    </header>
  );
}
