/**
 * Markdown editing workspace.
 *
 * A thin wrapper over the generic {@link FileEditor} that keeps the Markdown
 * live-preview pane. Committing is gated behind sign-in and verified push
 * permission inside FileEditor; nothing Markdown-specific changes that.
 */
import type { LinkContext } from '../../shared/markdown-links';
import FileEditor, { type CommitTarget } from './FileEditor';

export type { CommitTarget };

interface MarkdownEditorProps {
  fileName: string;
  initialContent: string;
  /** Link context for relative links in the live preview. */
  context: LinkContext;
  /** Invoked whenever the dirty flag changes (used by the tab guard). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Repository location; omit to keep the workspace local-only. */
  target?: CommitTarget;
}

export default function MarkdownEditor({ fileName, initialContent, context, onDirtyChange, target }: MarkdownEditorProps) {
  return (
    <FileEditor
      fileName={fileName}
      initialContent={initialContent}
      context={context}
      onDirtyChange={onDirtyChange}
      target={target}
      preview
    />
  );
}
