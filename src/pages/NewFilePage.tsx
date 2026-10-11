/**
 * "Add file" (V3-A, extended by Directive C).
 *
 * Two modes from one route (`/repos/:repo/new/:ref`):
 *
 *   ?kind=dir  create a directory — committed as `<directory>/.gitkeep`,
 *              because Git tracks files, not directories;
 *   default    create a file — a real editor with a live Markdown preview,
 *              committed to the current branch or to a new branch.
 *
 * Every gate below is advisory. `POST /api/repos/:repo/files` re-verifies the
 * session, AnkWorks organization membership, and push permission with the
 * signed-in user's own token before it writes anything to GitHub, and it
 * answers 409 when the path already exists.
 */
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useRepoPermissions } from '../hooks/useRepoPermissions';
import { joinRepoPath, validateDirectoryPath, validateFileName } from '../shared/files';
import { decodeRouteRef, parentPath, treePath } from '../shared/routes';
import { isValidRef } from '../shared/validation';
import RepoShell from '../components/explorer/RepoShell';
import FileEditor from '../components/explorer/FileEditor';
import BranchSelector from '../components/explorer/BranchSelector';
import CreateDirectoryForm, { newDirectoryPath, newFilePath } from '../components/explorer/CreateDirectoryForm';
import { ErrorState, Notice, Panel } from '../components/explorer/ui';

export default function NewFilePage() {
  const { repo = '', ref: refParam = '' } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { status: authStatus } = useAuth();
  const permissions = useRepoPermissions(repo);

  // `?path=` pre-fills the parent directory so "New file" from a directory page
  // lands in the right place.
  const parentParam = search.get('path') ?? '';
  const parentCheck = validateDirectoryPath(parentParam);
  const parent = parentCheck.ok ? parentCheck.value : '';
  const kind: 'file' | 'dir' = search.get('kind') === 'dir' ? 'dir' : 'file';

  const [directory, setDirectory] = useState(parent);
  const [name, setName] = useState('');

  const decoded = decodeRouteRef(refParam);
  const validRef = decoded !== null && isValidRef(decoded) ? decoded : null;

  if (validRef === null) {
    return (
      <RepoShell repo={repo} tab="code" sidebar={false}>
        {() => <ErrorState error={new Error('Invalid branch or commit.')} title="Invalid branch or commit" />}
      </RepoShell>
    );
  }

  const dirCheck = validateDirectoryPath(directory);
  const nameCheck = validateFileName(name);
  const path = joinRepoPath(directory, name.trim());
  const pathValid = path !== null && name.trim() !== '';

  const gate = (() => {
    if (authStatus === 'loading') return { ok: false, message: 'Checking your sign-in status…' };
    if (authStatus !== 'authenticated') return { ok: false, message: 'Creating files requires signing in with GitHub.' };
    if (permissions.error) return { ok: false, message: permissions.error };
    if (!permissions.loaded) return { ok: false, message: 'Checking repository permissions…' };
    if (!permissions.canWrite) return { ok: false, message: 'Creating files requires write access to this repository.' };
    return { ok: true, message: '' };
  })();

  return (
    <RepoShell repo={repo} tab="code" gitRef={validRef} sidebar={false}>
      {({ detail }) => (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-text">
                {kind === 'dir' ? 'Create a directory in' : 'Add file to'} {detail.name}
              </h2>
              <p className="text-xs text-muted">
                Committing on <span className="font-mono text-text">{validRef}</span>. The commit is made with your own GitHub
                account, after the server re-checks your membership and repository permission.
              </p>
            </div>
            <BranchSelector repo={repo} gitRef={validRef} mode="tree" path={parent} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link
              to={newFilePath(repo, validRef, parent)}
              aria-current={kind === 'file' ? 'page' : undefined}
              className={`rounded-md border px-2.5 py-1.5 ${
                kind === 'file' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted hover:text-text'
              }`}
            >
              New file
            </Link>
            <Link
              to={newDirectoryPath(repo, validRef, parent)}
              aria-current={kind === 'dir' ? 'page' : undefined}
              className={`rounded-md border px-2.5 py-1.5 ${
                kind === 'dir' ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted hover:text-text'
              }`}
            >
              New directory
            </Link>
          </div>

          <Panel>
            <div className="space-y-3 border-b border-border px-4 py-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label className="block">
                  <span className="label-sm">Directory</span>
                  <input
                    value={directory}
                    onChange={(event) => setDirectory(event.target.value)}
                    placeholder="src/components"
                    aria-invalid={!dirCheck.ok}
                    aria-label="Parent directory"
                    data-testid="new-file-directory"
                    className="input-sm font-mono"
                  />
                  <span className="mt-1 block text-xs text-muted">Empty means the repository root.</span>
                </label>
                <label className="block">
                  <span className="label-sm">{kind === 'dir' ? 'Directory name' : 'File name'}</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={kind === 'dir' ? 'docs' : 'example.md'}
                    aria-invalid={name.trim() !== '' && !nameCheck.ok}
                    aria-label={kind === 'dir' ? 'Directory name' : 'File name'}
                    data-testid="new-file-name"
                    className="input-sm font-mono"
                  />
                  <span className="mt-1 block text-xs text-muted">
                    One path segment — no “/”, no “..”.
                  </span>
                </label>
              </div>

              {name.trim() !== '' && !nameCheck.ok ? (
                <p role="alert" className="text-xs text-red-400" data-testid="new-file-name-error">
                  {nameCheck.ok ? '' : nameCheck.message}
                </p>
              ) : null}
              {!dirCheck.ok ? (
                <p role="alert" className="text-xs text-red-400">
                  {dirCheck.ok ? '' : dirCheck.message}
                </p>
              ) : null}

              {pathValid && path ? (
                <p className="text-xs text-muted">
                  Creating <span className="font-mono text-text">{path}</span> in{' '}
                  <Link to={treePath(repo, validRef, parentPath(path))} className="text-primary/90 hover:text-primary">
                    {parentPath(path) || '/'}
                  </Link>
                </p>
              ) : null}
            </div>

            {kind === 'dir' ? (
              <CreateDirectoryForm
                repo={repo}
                gitRef={validRef}
                parent={dirCheck.ok ? dirCheck.value : ''}
                name={name.trim()}
                onCreated={(branch, directoryPath) => navigate(treePath(repo, branch, directoryPath))}
              />
            ) : pathValid && path ? (
              <div className="px-4 py-4 sm:px-6">
                <FileEditor
                  key={`${validRef}|${path}`}
                  fileName={name.trim()}
                  initialContent=""
                  context={{ repo, commitSha: '', baseDir: parentPath(path) }}
                  target={{ repo, path, ref: validRef }}
                />
              </div>
            ) : (
              <div className="px-4 py-6">
                <Notice title="Enter a file name">The editor opens as soon as the directory and file name are valid.</Notice>
              </div>
            )}
          </Panel>

          {!gate.ok && <Notice title={gate.message} />}
        </div>
      )}
    </RepoShell>
  );
}
