/**
 * "Add file" (V3-A): create a new file on a branch through the authenticated
 * commit route.
 *
 * The UI gate is advisory only. `POST /api/repos/:repo/commit` re-verifies the
 * session, AnkWorks organization membership, and push permission with the
 * signed-in user's own token before it writes anything to GitHub.
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useRepoPermissions } from '../hooks/useRepoPermissions';
import { validateCommitPath } from '../shared/changes';
import { decodeRouteRef, parentPath, treePath } from '../shared/routes';
import { isValidRef } from '../shared/validation';
import RepoShell from '../components/explorer/RepoShell';
import FileEditor from '../components/explorer/FileEditor';
import BranchSelector from '../components/explorer/BranchSelector';
import { ErrorState, Notice, Panel } from '../components/explorer/ui';

export default function NewFilePage() {
  const { repo = '', ref: refParam = '' } = useParams();
  const { status: authStatus } = useAuth();
  const permissions = useRepoPermissions(repo);
  const [path, setPath] = useState('');

  const decoded = decodeRouteRef(refParam);
  const validRef = decoded !== null && isValidRef(decoded) ? decoded : null;

  if (validRef === null) {
    return (
      <RepoShell repo={repo} tab="code" sidebar={false}>
        {() => <ErrorState error={new Error('Invalid branch or commit.')} title="Invalid branch or commit" />}
      </RepoShell>
    );
  }

  const trimmed = path.trim().replace(/^\/+/, '');
  const check = trimmed === '' ? null : validateCommitPath(trimmed);
  const pathValid = check !== null && check.ok;

  const gate = (() => {
    if (authStatus === 'loading') return { ok: false, message: 'Checking your sign-in status…' };
    if (authStatus !== 'authenticated') return { ok: false, message: 'Creating a file requires signing in with GitHub.' };
    if (permissions.error) return { ok: false, message: permissions.error };
    if (!permissions.loaded) return { ok: false, message: 'Checking repository permissions…' };
    if (!permissions.canWrite) return { ok: false, message: 'Creating a file requires write access to this repository.' };
    return { ok: true, message: '' };
  })();

  return (
    <RepoShell repo={repo} tab="code" gitRef={validRef} sidebar={false}>
      {({ detail }) => (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-text">Add file to {detail.name}</h2>
              <p className="text-xs text-muted">
                Creating on <span className="font-mono text-text">{validRef}</span>. The commit is made with your own
                GitHub account.
              </p>
            </div>
            <BranchSelector repo={repo} gitRef={validRef} mode="tree" path="" />
          </div>

          <Panel>
            <div className="space-y-3 border-b border-border px-4 py-3">
              <label className="block">
                <span className="label-sm">File path</span>
                <input
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                  placeholder="docs/example.md"
                  className="input-sm font-mono"
                  aria-invalid={trimmed !== '' && !pathValid}
                />
              </label>
              {trimmed !== '' && !pathValid && (
                <p className="text-xs text-red-300">
                  Use a repository-relative path without “..”, backslashes, or control characters.
                </p>
              )}
              {pathValid && (
                <p className="text-xs text-muted">
                  Parent directory: <span className="font-mono">{parentPath(trimmed) || '/'}</span>{' '}
                  <Link to={treePath(repo, validRef, parentPath(trimmed))} className="text-primary/90 hover:text-primary">
                    open
                  </Link>
                </p>
              )}
            </div>

            {pathValid ? (
              <div className="px-4 py-4 sm:px-6">
                <FileEditor
                  key={`${validRef}|${trimmed}`}
                  fileName={trimmed.split('/').pop() ?? trimmed}
                  initialContent=""
                  context={{ repo, commitSha: '', baseDir: parentPath(trimmed) }}
                  target={{ repo, path: trimmed, ref: validRef }}
                />
              </div>
            ) : (
              <div className="px-4 py-6">
                <Notice title="Enter a file path">The editor opens as soon as the path is valid.</Notice>
              </div>
            )}
          </Panel>

          {!gate.ok && <Notice title={gate.message} />}
        </div>
      )}
    </RepoShell>
  );
}
