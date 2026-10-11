/**
 * File action toolbar with real, GitHub-backed operations (Directive C).
 *
 * Every destructive or structure-changing action opens a dialog that states
 * exactly what will happen, asks for a commit message, and — for deletion —
 * requires typing the file name before the button enables.
 *
 * The controls are gated on the signed-in user's verified state, but the gate
 * is advisory: the Worker re-checks session → membership → repository
 * permission → branch protection before it writes, and fails closed. A guest or
 * a non-member sees no action at all, and a user whose permission could not be
 * verified sees nothing rather than a button that would fail.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { filesApi } from '../../api/files';
import { ExplorerApiError } from '../../api/explorer';
import { useAuth } from '../../auth/AuthContext';
import { useRepoPermissions } from '../../hooks/useRepoPermissions';
import { joinRepoPath, validateFileName } from '../../shared/files';
import { blobPath, commitsPath, fileName, parentPath, treePath } from '../../shared/routes';
import { DownloadIcon, EditIcon, HistoryIcon, MoveIcon, TrashIcon } from './icons';
import Modal from './Modal';
import { CopyButton, ExternalLink } from './ui';

interface FileActionsProps {
  repo: string;
  /** Branch the file is being viewed on. */
  gitRef: string;
  path: string;
  /** Blob sha of the loaded file; required for delete and for change detection. */
  blobSha: string;
  rawUrl: string;
  showRaw: boolean;
  /** False for binary, oversized, symlinked, and submodule paths: nothing to rewrite. */
  editable: boolean;
}

interface Done {
  branch: string;
  url: string;
}

export default function FileActions({ repo, gitRef, path, blobSha, rawUrl, showRaw, editable }: FileActionsProps) {
  const { status, isMember } = useAuth();
  const permissions = useRepoPermissions(repo);
  const [dialog, setDialog] = useState<'rename' | 'move' | 'delete' | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  // Advisory gate only. The Worker decides.
  const canManage = editable && status === 'authenticated' && isMember && permissions.loaded && permissions.canWrite;
  const name = fileName(path);

  const close = () => setDialog(null);

  const onCommitted = (response: { branch: string; path?: string; action?: string }) => {
    const branch = response.branch;
    if (response.action === 'delete') {
      setDone({ branch, url: treePath(repo, branch, parentPath(path)) });
    } else {
      setDone({ branch, url: blobPath(repo, branch, response.path ?? path) });
    }
    setDialog(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showRaw && (
        <a href={rawUrl} download={name} className="btn-secondary-sm" data-testid="file-action-raw">
          <DownloadIcon size={14} /> Raw
        </a>
      )}
      <Link to={commitsPath(repo, gitRef)} className="btn-secondary-sm" data-testid="file-action-history">
        <HistoryIcon size={14} /> History
      </Link>
      <CopyButton text={path} label={`Copy the path of ${name}`} className="btn-secondary-sm" idleLabel="Copy path" />

      {canManage && (
        <>
          <Link to={`${blobPath(repo, gitRef, path)}?view=edit`} className="btn-secondary-sm" data-testid="edit-file-button">
            <EditIcon size={14} /> Edit
          </Link>
          <button type="button" onClick={() => setDialog('rename')} className="btn-secondary-sm" data-testid="file-action-rename">
            <EditIcon size={14} /> Rename
          </button>
          <button type="button" onClick={() => setDialog('move')} className="btn-secondary-sm" data-testid="file-action-move">
            <MoveIcon size={14} /> Move
          </button>
          <button
            type="button"
            onClick={() => setDialog('delete')}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-300 transition-colors hover:bg-red-500/20"
            data-testid="file-action-delete"
          >
            <TrashIcon size={14} /> Delete
          </button>
        </>
      )}

      {dialog === 'rename' && (
        <PathDialog
          mode="rename"
          repo={repo}
          gitRef={gitRef}
          path={path}
          blobSha={blobSha}
          onClose={close}
          onCommitted={onCommitted}
        />
      )}
      {dialog === 'move' && (
        <PathDialog
          mode="move"
          repo={repo}
          gitRef={gitRef}
          path={path}
          blobSha={blobSha}
          onClose={close}
          onCommitted={onCommitted}
        />
      )}
      {dialog === 'delete' && (
        <DeleteDialog
          repo={repo}
          gitRef={gitRef}
          path={path}
          blobSha={blobSha}
          onClose={close}
          onCommitted={onCommitted}
        />
      )}

      {done ? (
        <p className="w-full text-xs text-primary" data-testid="file-action-result">
          Committed to <span className="font-mono">{done.branch}</span> ·{' '}
          <Link to={done.url} className="underline">
            Open the result
          </Link>{' '}
          ·{' '}
          <ExternalLink href={`https://github.com/ankworks/${encodeURIComponent(repo)}/commits/${encodeURIComponent(done.branch)}`}>
            View on GitHub
          </ExternalLink>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface DialogProps {
  repo: string;
  gitRef: string;
  path: string;
  blobSha: string;
  onClose: () => void;
  onCommitted: (response: { branch: string; path?: string; action?: string }) => void;
}

/**
 * Rename or move.
 *
 * Both are the same GitHub operation (one atomic commit that removes the old
 * path and adds the new one); the dialog only differs in what it pre-fills and
 * how it words the fields. Moving a directory moves every file under it.
 */
function PathDialog({ mode, repo, gitRef, path, blobSha, onClose, onCommitted }: DialogProps & { mode: 'rename' | 'move' }) {
  const initial = mode === 'rename' ? fileName(path) : path;
  const [value, setValue] = useState(initial);
  const [message, setMessage] = useState(mode === 'rename' ? `Rename ${fileName(path)}` : `Move ${fileName(path)}`);
  const [newBranch, setNewBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const directory = mode === 'rename' ? parentPath(path) : '';
  const trimmed = value.trim();
  const candidate = mode === 'rename' ? joinRepoPath(directory, trimmed) : trimmed;
  const nameCheck = mode === 'rename' ? validateFileName(trimmed) : null;

  const validity = useMemo(() => {
    if (trimmed === '') return 'Enter a new path.';
    if (nameCheck && !nameCheck.ok) return nameCheck.message;
    if (candidate === null) return 'That path is not valid.';
    if (candidate === path) return 'The new path is identical to the current one.';
    if (/(^|\/)\.\.(\/|$)/.test(candidate) || candidate.startsWith('/') || candidate.includes('\\')) {
      return 'Use a repository-relative path without "..", backslashes, or a leading "/".';
    }
    return null;
  }, [candidate, nameCheck, path, trimmed]);

  const submit = async () => {
    if (!candidate || validity) return;
    setBusy(true);
    setLocalError(null);
    try {
      const response = await filesApi.move(repo, {
        from: path,
        to: candidate,
        message,
        branch: gitRef,
        ...(newBranch.trim() !== '' ? { newBranch: newBranch.trim() } : {}),
        ...(blobSha ? { sha: blobSha } : {}),
      });
      onCommitted({ branch: response.branch, path: response.to ?? candidate, action: 'move' });
    } catch (error) {
      setLocalError(error instanceof ExplorerApiError ? error.message : 'The operation failed unexpectedly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === 'rename' ? `Rename ${fileName(path)}` : `Move ${fileName(path)}`}
      description={
        mode === 'rename'
          ? 'Renaming rewrites the path in one commit. Nothing is copied and no history is lost.'
          : 'Moving rewrites the path in one commit. Moving a directory moves every file inside it.'
      }
      onClose={onClose}
      testId={`${mode}-dialog`}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary-sm" disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || validity !== null}
            className="btn-primary-sm disabled:cursor-not-allowed disabled:opacity-60"
            data-testid={`${mode}-submit`}
          >
            {busy ? 'Committing…' : mode === 'rename' ? 'Rename file' : 'Move file'}
          </button>
        </>
      }
    >
      <label className="block">
        <span className="label-sm">{mode === 'rename' ? 'New file name' : 'New path'}</span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-invalid={validity !== null && trimmed !== ''}
          aria-label={mode === 'rename' ? 'New file name' : 'New repository path'}
          className="input-sm font-mono"
          data-testid={`${mode}-path-input`}
        />
      </label>
      <p className="text-xs text-muted">
        Result: <span className="font-mono text-text">{candidate ?? '—'}</span>
      </p>
      {validity && trimmed !== '' ? (
        <p role="alert" className="text-xs text-red-400">
          {validity}
        </p>
      ) : null}

      <label className="block">
        <span className="label-sm">Commit message</span>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          aria-label="Commit message"
          className="input-sm font-mono"
        />
      </label>

      <label className="block">
        <span className="label-sm">Commit to a new branch (optional)</span>
        <input
          value={newBranch}
          onChange={(event) => setNewBranch(event.target.value)}
          placeholder={gitRef}
          aria-label="New branch name (optional)"
          className="input-sm font-mono"
        />
      </label>
      <p className="text-xs text-muted">
        Leave empty to commit directly to <span className="font-mono text-text">{gitRef}</span>. A new branch is created from it and
        never bypasses branch protection.
      </p>

      {localError ? (
        <p role="alert" className="text-xs text-red-400">
          {localError}
        </p>
      ) : null}
    </Modal>
  );
}

/**
 * Delete one file.
 *
 * The confirmation requires typing the file name, and the Worker refuses the
 * delete when the blob sha no longer matches — so a file that changed since it
 * was loaded cannot be deleted by mistake. Directories are not deleted
 * recursively; the Worker says so and the user deletes the files inside.
 */
function DeleteDialog({ repo, gitRef, path, blobSha, onClose, onCommitted }: DialogProps) {
  const name = fileName(path);
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState(`Delete ${name}`);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const matches = confirmation.trim() === name;

  const submit = async () => {
    if (!matches) return;
    setBusy(true);
    setLocalError(null);
    try {
      const response = await filesApi.remove(repo, { path, message, branch: gitRef, sha: blobSha });
      onCommitted({ branch: response.branch, action: 'delete' });
    } catch (error) {
      setLocalError(error instanceof ExplorerApiError ? error.message : 'The delete failed unexpectedly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Delete ${name}`}
      description="This commits a deletion. The file stays in the repository history and can be restored with Git."
      destructive
      onClose={onClose}
      testId="delete-dialog"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary-sm" disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !matches}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-500/50 bg-red-500/20 px-2.5 py-1.5 text-xs font-medium text-red-200 transition-colors enabled:hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="delete-submit"
          >
            <TrashIcon size={14} />
            {busy ? 'Deleting…' : 'Delete file'}
          </button>
        </>
      }
    >
      <dl className="space-y-1 text-xs">
        <div className="flex gap-2">
          <dt className="text-muted">File</dt>
          <dd className="min-w-0 break-all font-mono text-text">{path}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Branch</dt>
          <dd className="font-mono text-text">{gitRef}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">Blob</dt>
          <dd className="font-mono text-text">{blobSha ? blobSha.slice(0, 7) : 'unknown'}</dd>
        </div>
      </dl>

      <label className="block">
        <span className="label-sm">
          Type <span className="font-mono text-text">{name}</span> to confirm
        </span>
        <input
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          aria-label={`Type ${name} to confirm deletion`}
          className="input-sm font-mono"
          data-testid="delete-confirm-input"
        />
      </label>

      <label className="block">
        <span className="label-sm">Commit message</span>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          aria-label="Commit message"
          className="input-sm font-mono"
        />
      </label>

      <p className="text-xs text-muted">
        Directories are not deleted recursively: delete the files inside them, or use Git for a bulk removal.
      </p>

      {localError ? (
        <p role="alert" className="text-xs text-red-400">
          {localError}
        </p>
      ) : null}
    </Modal>
  );
}
