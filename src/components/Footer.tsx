import { ExternalLink } from './explorer/ui';

export default function Footer() {
  return (
    <footer className="mt-10 border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          AnkWorks Forge is a GitHub-powered development platform for exploring repositories, collaborating on projects,
          and managing software development. GitHub remains the source of truth.
        </p>
        <div className="flex items-center gap-4">
          {/* Links point at the organization, never at the Forge implementation
              repository the site is served from. */}
          <ExternalLink href="https://github.com/ankworks">GitHub</ExternalLink>
          <a href="/about" className="hover:text-text">
            About
          </a>
        </div>
      </div>
    </footer>
  );
}
