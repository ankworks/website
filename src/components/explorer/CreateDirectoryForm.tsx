/**
 * "Create directory" (Directive C).
 *
 * Git does not track directories — a directory exists only while it holds a
 * file, so an empty directory cannot be committed at all. The only honest way
 * to create one through the API is to commit a file inside it, and `.gitkeep`
 * is the convention everybody recognises. This form says exactly that instead
 * of pretending otherwise.
 *
 * The commit is a normal authenticated file create; the Worker re-verifies
 * session, membership, repository permission, and branch protection.
 */
import { useState } from 'react';
import { filesApi } from '../../api/files';
import { ExplorerApiError } from '../../api/explorer';
import { joinRepoPath, validateFileName } from '../../shared/files';
import { GITKEEP_NAME } from '../../shared/files';
import { Notice } from './ui';

interface CreateDirectoryFormProps {
  repo: string;
  /** Branch the directory is created on. */
  gitRef: string;
  /** Parent directory inside the repository ("" for the root). */
  parent: string;
  /** New directory name, owned and validated by the page. */
  name: string;
  /** Called after a successful commit with the branch the commit landed on. */
  onCreated: (branch: string, directory: string) => void;
}

export default function CreateDirectoryForm({ repo, gitRef, parent, name, onCreated }: CreateDirectoryFormProps) {
  const [message, setMessage] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const check = validateFileName(trimmed === '' ? 'x' : trimmed);
  const valid = trimmed !== '' && check.ok;
  const directory = valid ? joinRepoPath(parent, trimmed) : null;
  const placeholderPath = directory === null ? null : `${directory}/${GITKEEP_NAME}`;

  const submit = async () => {
    if (!placeholderPath || !directory) return;
    setBusy(true);
    setError(null);
    try {
      const response = await filesApi.create(repo, {
        path: placeholderPath,
        content: '',
        message: message.trim() === '' ? `Add ${directory} directory` : message.trim(),
        branch: gitRef,
        ...(newBranch.trim() !== '' ? { newBranch: newBranch.trim() } : {}),
      });
      onCreated(response.branch, directory);
    } catch (caught) {
      setError(caught instanceof ExplorerApiError ? caught.message : 'The directory could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-4">
      <Notice title="Directories need a file">
        Git tracks files, not directories. Forge creates <span className="font-mono text-text">{GITKEEP_NAME}</span> inside the new
        directory, which is the standard placeholder for keeping an otherwise empty directory. Delete it later if you prefer.
      </Notice>

      {trimmed !== '' && !valid ? (
        <p role="alert" className="text-xs text-red-400">
          {check.ok ? 'Enter a directory name.' : check.message}
        </p>
      ) : null}
      {placeholderPath ? (
        <p className="text-xs text-muted">
          Creates <span className="font-mono text-text">{placeholderPath}</span> on{' '}
          <span className="font-mono text-text">{gitRef}</span>.
        </p>
      ) : null}

      <label className="block">
        <span className="label-sm">Commit message</span>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={directory ? `Add ${directory} directory` : 'Add directory'}
          aria-label="Commit message"
          data-testid="directory-commit-message"
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

      {error ? (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy || !valid}
        className="btn-primary-sm disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="create-directory-submit"
      >
        {busy ? 'Creating…' : 'Create directory'}
      </button>
    </div>
  );
}

/** Route to the create-directory form for a parent path. */
export function newDirectoryPath(repo: string, gitRef: string, parent: string): string {
  const base = `/repos/${encodeURIComponent(repo)}/new/${encodeURIComponent(gitRef)}?kind=dir`;
  return parent === '' ? base : `${base}&path=${encodeURIComponent(parent)}`;
}

/** Route to the create-file form for a parent path. */
export function newFilePath(repo: string, gitRef: string, parent: string): string {
  const base = `/repos/${encodeURIComponent(repo)}/new/${encodeURIComponent(gitRef)}`;
  return parent === '' ? base : `${base}?path=${encodeURIComponent(parent)}`;
}
