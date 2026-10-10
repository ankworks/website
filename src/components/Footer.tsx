import { ExternalLink } from './explorer/ui';

export default function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          Read-only explorer. GitHub is the source of truth; data is fetched from the GitHub REST API through the
          AnkWorks Worker.
        </p>
        <div className="flex items-center gap-4">
          <ExternalLink href="https://github.com/ankworks/website">Source of this site</ExternalLink>
          <a href="/about" className="hover:text-text">
            About
          </a>
        </div>
      </div>
    </footer>
  );
}
