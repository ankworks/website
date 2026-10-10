import { ExternalLink } from './explorer/ui';

export default function Footer() {
  return (
    <footer className="mt-10 border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>AnkWorks Forge is read-only. GitHub remains the source of truth; public data is served through the AnkWorks Worker.</p>
        <div className="flex items-center gap-4">
          <ExternalLink href="https://github.com/ankworks/website">Source</ExternalLink>
          <a href="/about" className="hover:text-text">About</a>
        </div>
      </div>
    </footer>
  );
}
