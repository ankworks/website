import { Navigate } from 'react-router-dom';
import { explorerApi } from '../../api/explorer';
import { useAsync } from '../../hooks/useAsync';
import { countLines, formatBytes, shortSha } from '../../lib/format';
import { detectLanguage } from '../../shared/languages';
import { blobPath, fileName, githubRepoLink, treePath } from '../../shared/routes';
import { EXPLORER_LIMITS } from '../../shared/limits';
import type { FileResponse } from '../../types';
import Breadcrumbs from './Breadcrumbs';
import BranchSelector from './BranchSelector';
import CodeView from './CodeView';
import { DownloadIcon, LinkIcon } from './icons';
import { CopyButton, ErrorState, ExternalLink, Notice, Panel, Skeleton } from './ui';

interface FileViewProps {
  repo: string;
  gitRef: string;
  path: string;
}

/** Read-only file viewer: metadata, actions, and the content or a clear notice. */
export default function FileView({ repo, gitRef, path }: FileViewProps) {
  const state = useAsync(`file|${repo}|${gitRef}|${path}`, () => explorerApi.file(repo, gitRef, path));

  if (state.status === 'loading' || state.status === 'idle') {
    return <Skeleton className="h-72 w-full" />;
  }
  if (state.status === 'error') {
    const code = (state.error as { code?: unknown } | null)?.code;
    if (code === 'IS_DIRECTORY') {
      return <Navigate to={treePath(repo, gitRef, path)} replace />;
    }
    return (
      <div className="space-y-4">
        <BranchSelector repo={repo} gitRef={gitRef} mode="blob" path={path} />
        <ErrorState error={state.error} onRetry={state.reload} />
      </div>
    );
  }
  if (!state.data) return null;
  return <FileContent file={state.data} repo={repo} gitRef={gitRef} path={path} />;
}

function FileContent({ file, repo, gitRef, path }: FileViewProps & { file: FileResponse }) {
  const language = detectLanguage(path);
  const rawUrl = explorerApi.rawUrl(repo, gitRef, path);
  const commitUrl = githubRepoLink(repo, 'commit', file.commit_sha);
  const permalink = () => `${window.location.origin}${blobPath(repo, file.commit_sha, path)}`;
  const isText = file.kind === 'text' && typeof file.content === 'string';
  const showRaw = file.kind !== 'symlink' && file.kind !== 'submodule' && file.size <= EXPLORER_LIMITS.RAW_MAX_BYTES;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs repo={repo} gitRef={gitRef} path={path} isFile />
        <BranchSelector repo={repo} gitRef={gitRef} mode="blob" path={path} />
      </div>

      <Panel aria-label={`File ${fileName(path)}`}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-elevated/40 px-4 py-2.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="font-mono text-sm text-text">{fileName(path)}</span>
            <span>{language.label}</span>
            <span>{formatBytes(file.size)}</span>
            {isText && file.content !== undefined && <span>{countLines(file.content)} lines</span>}
            <span>
              Commit{' '}
              <ExternalLink href={commitUrl} className="font-mono">
                {shortSha(file.commit_sha)}
              </ExternalLink>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isText && file.content !== undefined && (
              <CopyButton text={file.content} label={`Copy contents of ${fileName(path)}`} />
            )}
            <CopyButton
              text={permalink()}
              label="Copy permalink to this file"
              className="btn-secondary-sm"
              idleLabel="Permalink"
              icon={<LinkIcon size={14} />}
            />
            {showRaw && (
              <a href={rawUrl} download={fileName(path)} className="btn-secondary-sm">
                <DownloadIcon size={14} />
                Raw
              </a>
            )}
            <ExternalLink href={file.html_url} className="btn-secondary-sm">
              GitHub
            </ExternalLink>
          </div>
        </div>

        <FileBody file={file} repo={repo} gitRef={gitRef} path={path} grammar={language.grammar} rawUrl={rawUrl} />
      </Panel>
    </div>
  );
}

function FileBody({
  file,
  path,
  grammar,
  rawUrl,
}: FileViewProps & { file: FileResponse; grammar: string | null; rawUrl: string }) {
  switch (file.kind) {
    case 'text':
      return file.content !== undefined ? (
        <CodeView content={file.content} grammar={grammar} fileName={fileName(path)} />
      ) : (
        <div className="p-4">
          <Notice title="No content">The file is empty or its content could not be read.</Notice>
        </div>
      );
    case 'binary':
      return (
        <Notice title="Binary file not shown">
          This file is not UTF-8 text.{' '}
          <a href={rawUrl} download={fileName(path)} className="text-primary/90 hover:text-primary">
            Download the raw file
          </a>
          .
        </Notice>
      );
    case 'lfs-pointer':
      return (
        <Notice title="Stored with Git LFS">
          The repository contains only a Git LFS pointer, so the file content is not available here.{' '}
          <ExternalLink href={file.html_url}>View on GitHub</ExternalLink>
        </Notice>
      );
    case 'too-large':
      return (
        <Notice title="File is too large to display">
          {formatBytes(file.size)} exceeds the {formatBytes(EXPLORER_LIMITS.VIEW_MAX_BYTES)} viewer limit.{' '}
          <a href={rawUrl} download={fileName(path)} className="text-primary/90 hover:text-primary">
            Download the raw file
          </a>{' '}
          or <ExternalLink href={file.html_url}>view it on GitHub</ExternalLink>.
        </Notice>
      );
    case 'symlink':
      return (
        <Notice title="Symbolic link">
          Points to <span className="font-mono text-text">{file.target ?? 'an unknown target'}</span>. Links are not followed.{' '}
          <ExternalLink href={file.html_url}>View on GitHub</ExternalLink>
        </Notice>
      );
    case 'submodule':
      return (
        <Notice title="Submodule">
          This path is a Git submodule pinned to another repository.{' '}
          {file.submodule_url ? <ExternalLink href={file.submodule_url}>Open the submodule on GitHub</ExternalLink> : null}
        </Notice>
      );
    default:
      return null;
  }
}

