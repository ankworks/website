import { useEffect, useId, useRef, type ReactNode } from 'react';
import { XIcon } from './icons';

interface ModalProps {
  title: string;
  /** Short line under the title. */
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Danger styling for destructive confirmations. */
  destructive?: boolean;
  /** Test hook. */
  testId?: string;
}

/**
 * Accessible modal used by the file dialogs.
 *
 * Closes on Escape and on a backdrop click, keeps focus inside while open, and
 * restores focus to whatever opened it. There is no route change: the dialog is
 * a layer over the file view, so cancelling never loses the page.
 */
export default function Modal({ title, description, onClose, children, footer, destructive = false, testId }: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const node = panelRef.current;
    const focusable = node?.querySelector<HTMLElement>('input, textarea, button, [href], select');
    (focusable ?? node)?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        data-testid={testId}
        tabIndex={-1}
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-surface shadow-2xl focus:outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 id={titleId} className={`text-sm font-semibold ${destructive ? 'text-red-300' : 'text-text'}`}>
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-xs text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-md p-1 text-muted transition-colors hover:bg-elevated hover:text-text"
          >
            <XIcon size={15} />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">{children}</div>

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-elevated/40 px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
