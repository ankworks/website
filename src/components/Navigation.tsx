import { Link, NavLink, useLocation } from 'react-router-dom';
import { MenuIcon } from './explorer/icons';
import ThemeToggle from './ThemeToggle';

type NavItem = { label: string; to: string; section: 'dashboard' | 'explore' | 'repositories' | 'issues' | 'pulls' | 'about' };

const ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', section: 'dashboard' },
  { label: 'Explore', to: '/explore', section: 'explore' },
  { label: 'Repositories', to: '/repos', section: 'repositories' },
  { label: 'Issues', to: '/issues', section: 'issues' },
  { label: 'Pull Requests', to: '/pulls', section: 'pulls' },
  { label: 'About', to: '/about', section: 'about' },
];

function activeFor(section: NavItem['section'], pathname: string): boolean {
  if (section === 'dashboard') return pathname === '/';
  if (section === 'explore') return pathname === '/explore';
  if (section === 'repositories') return pathname === '/repos' || (pathname.startsWith('/repos/') && !/\/(issues|pulls)\b/.test(pathname));
  if (section === 'issues') return pathname === '/issues' || /\/issues(?:\/|$)/.test(pathname);
  if (section === 'pulls') return pathname === '/pulls' || /\/pulls(?:\/|$)/.test(pathname);
  return pathname === '/about';
}

export default function Navigation() {
  const { pathname } = useLocation();

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background">
      <div className="mx-auto flex min-h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link to="/" aria-label="AnkWorks Forge home" className="flex shrink-0 items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:ring-primary/60">
          <img src="/branding/ankworks-logo.webp" alt="" width={28} height={28} className="h-7 w-7 rounded-md object-cover" />
          <span className="font-semibold tracking-tight text-text">AnkWorks</span>
          <span className="hidden border-l border-border pl-2 text-sm text-muted sm:inline">Forge</span>
        </Link>

        <nav aria-label="Primary navigation" className="ml-2 hidden items-center gap-0.5 xl:flex">
          {ITEMS.map((item) => <NavigationLink key={item.section} item={item} pathname={pathname} />)}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-muted sm:inline-flex">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" /> Read-only
          </span>
          <ThemeToggle />
          <details className="relative xl:hidden">
            <summary aria-label="Open navigation menu" className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-text hover:bg-elevated focus-visible:ring-2 focus-visible:ring-primary/60 [&::-webkit-details-marker]:hidden">
              <MenuIcon size={15} /> <span className="hidden sm:inline">Menu</span>
            </summary>
            <nav aria-label="Mobile navigation" className="absolute right-0 top-[calc(100%+0.5rem)] z-50 min-w-52 rounded-lg border border-border bg-surface p-1.5 shadow-xl">
              {ITEMS.map((item) => <NavigationLink key={item.section} item={item} pathname={pathname} mobile />)}
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

function NavigationLink({ item, pathname, mobile = false }: { item: NavItem; pathname: string; mobile?: boolean }) {
  const active = activeFor(item.section, pathname);
  return (
    <NavLink
      to={item.to}
      end={item.section === 'dashboard' || item.section === 'repositories' || item.section === 'explore' || item.section === 'about'}
      aria-current={active ? 'page' : undefined}
      className={`${mobile ? 'block' : 'inline-flex'} rounded-md px-2.5 py-2 text-sm transition-colors ${
        active ? 'bg-elevated font-medium text-text' : 'text-muted hover:bg-elevated/70 hover:text-text'
      }`}
    >
      {item.label}
    </NavLink>
  );
}
