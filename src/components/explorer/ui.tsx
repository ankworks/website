/** Small presentational primitives shared by the explorer pages. */
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { describeError } from '../../lib/errors';
import { AlertIcon, CheckIcon, CopyIcon, ExternalIcon } from './icons';

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`motion-safe:animate-pulse rounded bg-elevated ${className}`} />;
}

export function SkeletonRows({ rows = 6, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-px p-3">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-7 w-full" />
      ))}
    </div>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'error';
  title?: string;
  children?: ReactNode;
}) {
  const toneClass =
    tone === 'error'
      ? 'border-red-500/40 bg-red-500/5'
      : tone === 'warning'
        ? 'border-primary/30 bg-primary/5'
        : 'border-border bg-surface';
  return (
    <div role={tone === 'error' ? 'alert' : 'note'} className={`flex gap-3 rounded-md border px-4 py-3 ${toneClass}`}>
      <AlertIcon className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 text-sm">
        {title && <p className="font-medium text-text">{title}</p>}
        {children && <div className="mt-0.5 text-muted">{children}</div>}
      </div>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title,
  compact = false,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  compact?: boolean;
}) {
  const description = describeError(error);
  return (
    <div role="alert" className={`flex flex-col items-start gap-3 ${compact ? 'p-3' : 'rounded-md border border-border bg-surface p-6'}`}>
      <div>
        <p className="font-medium text-text">{title ?? description.title}</p>
        <p className="mt-1 text-sm text-muted">{description.message}</p>
      </div>
      {onRetry && description.retryable && (
        <button type="button" onClick={onRetry} className="btn-secondary-sm">
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 p-6 text-sm">
      <p className="font-medium text-text">{title}</p>
      {children && <div className="text-muted">{children}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warning' }) {
  const toneClass =
    tone === 'accent'
      ? 'border-primary/40 text-primary'
      : tone === 'warning'
        ? 'border-amber-500/40 text-amber-300'
        : 'border-border text-muted';
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-px text-[11px] font-medium leading-5 ${toneClass}`}>
      {children}
    </span>
  );
}

export function ExternalLink({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-muted transition-colors hover:text-text ${className}`}
    >
      {children}
      <ExternalIcon size={12} className="shrink-0" />
      <span className="sr-only">(opens on GitHub)</span>
    </a>
  );
}

/** Copies text to the clipboard and announces the result. */
export function CopyButton({
  text,
  label,
  idleLabel = 'Copy',
  icon,
  className = '',
}: {
  text: string;
  label: string;
  idleLabel?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  };

  const buttonText = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : idleLabel;
  return (
    <button type="button" onClick={copy} className={`btn-secondary-sm ${className}`} aria-label={label}>
      {state === 'copied' ? <CheckIcon size={14} /> : (icon ?? <CopyIcon size={14} />)}
      <span>{buttonText}</span>
      <span role="status" className="sr-only">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </button>
  );
}

export function TextLink({ to, children, className = '' }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`text-primary/90 transition-colors hover:text-primary ${className}`}>
      {children}
    </Link>
  );
}

/** Panel wrapper with the explorer's standard border and surface. */
export function Panel({ children, className = '', ...rest }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return (
    <section className={`overflow-hidden rounded-md border border-border bg-surface ${className}`} {...rest}>
      {children}
    </section>
  );
}
