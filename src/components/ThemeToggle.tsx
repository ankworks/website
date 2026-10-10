import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './explorer/icons';

type Theme = 'dark' | 'light';
const STORAGE_KEY = 'ankworks-forge-theme';

function storedTheme(): Theme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(storedTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Theme preference remains active for this page even when storage is unavailable.
    }
  }, [theme]);

  const nextTheme: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      onClick={() => setTheme(nextTheme)}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-muted transition-colors hover:bg-elevated hover:text-text focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      {theme === 'dark' ? <SunIcon size={15} /> : <MoonIcon size={15} />}
      <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}
