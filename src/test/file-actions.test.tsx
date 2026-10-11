import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { invalidateCache } from '../api/github';
import { clearExplorerCache } from '../api/explorer';
import { clearRepoPermissionsCache } from '../lib/repo-permissions-cache';
import { GUEST, MEMBER, NON_MEMBER } from './helpers/membership';

/**
 * File management UI (Directive C).
 *
 * The rules these tests pin down:
 *
 * - Raw, History, and Copy path are always available; Edit, Rename, Move, and
 *   Delete appear only for a verified member with write access.
 * - Deleting requires typing the file name, and the request carries the blob
 *   sha the viewer loaded so the server can refuse a stale delete.
 * - Rename and Move are the same one-commit operation; the dialog shows the
 *   resulting path before anything is sent.
 * - Creating a directory says plainly that it commits `.gitkeep`, because Git
 *   has no directories.
 *
 * Authorization itself is asserted in worker-files.test.ts — the Worker
 * re-verifies everything regardless of what the UI shows.
 */

const BLOB_SHA = 'd'.repeat(40);
const COMMIT_SHA = 'c'.repeat(40);
const REPO = 'aurelia';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type FetchMock = ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

type Viewer = 'writer' | 'reader' | 'non-member' | 'anonymous';

const SESSIONS: Record<Viewer, Record<string, unknown>> = {
  writer: { authenticated: true, user: { id: 1, login: 'octo-write', name: null, avatarUrl: '', htmlUrl: '' }, expiresAt: '2027-01-01T00:00:00.000Z', authEnabled: true },
  reader: { authenticated: true, user: { id: 2, login: 'octo-read', name: null, avatarUrl: '', htmlUrl: '' }, expiresAt: '2027-01-01T00:00:00.000Z', authEnabled: true },
  'non-member': { authenticated: true, user: { id: 3, login: 'outsider', name: null, avatarUrl: '', htmlUrl: '' }, expiresAt: '2027-01-01T00:00:00.000Z', authEnabled: true },
  anonymous: { authenticated: false, user: null, expiresAt: null, authEnabled: true },
};

const DETAIL = {
  repo: {
    id: 5,
    name: REPO,
    full_name: `ankworks/${REPO}`,
    private: false,
    html_url: `https://github.com/ankworks/${REPO}`,
    description: 'Test repository',
    language: 'TypeScript',
    stargazers_count: 1,
    forks_count: 0,
    updated_at: '2026-01-01T00:00:00Z',
    created_at: '2025-01-01T00:00:00Z',
    pushed_at: '2026-01-01T00:00:00Z',
    archived: false,
    fork: false,
    size: 10,
    open_issues_count: 0,
    topics: [],
    default_branch: 'main',
    license: null,
    homepage: null,
    has_wiki: false,
    has_issues: true,
    visibility: 'public',
    watchers_count: 0,
  },
};

function fileBody(path: string, content: string) {
  return {
    repo: REPO,
    ref: 'main',
    commit_sha: COMMIT_SHA,
    path,
    name: path.split('/').pop() ?? path,
    kind: 'text',
    size: content.length,
    blob_sha: BLOB_SHA,
    html_url: `https://github.com/ankworks/${REPO}/blob/main/${path}`,
    content,
    target: null,
    submodule_url: null,
  };
}

interface Recorded {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

describe('file management UI', () => {
  let fetchMock: FetchMock;
  let writes: Recorded[];
  let moveStatus: number;
  let deleteStatus: number;

  function install(viewer: Viewer) {
    writes = [];
    moveStatus = 200;
    deleteStatus = 200;
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async (input, init) => {
      const url = new URL(String(input), 'https://site.test');
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = url.pathname;

      if (path === '/api/auth/session') return json(SESSIONS[viewer]);
      if (path === '/api/auth/membership') {
        if (viewer === 'anonymous') return json(GUEST());
        if (viewer === 'non-member') return json(NON_MEMBER());
        return json(MEMBER({ login: viewer === 'writer' ? 'octo-write' : 'octo-read' }));
      }
      if (path === '/api/auth/permissions') {
        if (viewer === 'anonymous') return json({ error: 'UNAUTHENTICATED', message: 'Sign in.', status: 401 }, 401);
        return json({
          owner: 'ankworks',
          repo: REPO,
          canRead: true,
          canWrite: viewer === 'writer',
          canTriage: viewer === 'writer',
          canAdmin: viewer === 'writer',
          role: viewer === 'writer' ? 'admin' : 'read',
          source: 'user-token',
        });
      }
      if (path === '/api/featured') return json({ items: [], configured: false, fetched_at: '2026-01-01T00:00:00Z' });
      if (path === '/api/repos') return json({ org: 'ankworks', repos: [DETAIL.repo], total_count: 1, fetched_at: '2026-01-01T00:00:00Z' });
      if (path === `/api/repos/${REPO}` && method === 'GET') return json(DETAIL);
      if (path === `/api/repos/${REPO}/file`) {
        const requested = url.searchParams.get('path') ?? '';
        if (requested === 'docs/guide.md') return json(fileBody('docs/guide.md', '# Guide\n\nhello\n'));
        return json({ error: 'PATH_NOT_FOUND', message: 'Not found.', status: 404 }, 404);
      }
      if (path === `/api/repos/${REPO}/tree`) {
        return json({ entries: [{ name: 'guide.md', path: 'docs/guide.md', type: 'file', size: 13, html_url: 'https://github.com/x' }], truncated: false, fetched_at: '2026-01-01T00:00:00Z' });
      }
      if (path === `/api/repos/${REPO}/last-commit`) {
        return json({ path: 'docs', commit: { sha: COMMIT_SHA, title: 'Update', author_name: 'octo', date: '2026-01-01T00:00:00Z', html_url: 'https://github.com/x' } });
      }
      if (path === `/api/repos/${REPO}/branches`) return json({ branches: [{ name: 'main', commit: { sha: COMMIT_SHA, url: '' }, protected: false }], page: 1, per_page: 50, has_next: false });
      if (path === `/api/repos/${REPO}/tags`) return json({ tags: [], page: 1, per_page: 50, has_next: false });

      if (method !== 'GET') {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        } catch {
          body = {};
        }
        writes.push({ method, path, body });

        if (path === `/api/repos/${REPO}/files` && method === 'DELETE') {
          if (deleteStatus !== 200) return json({ error: 'SHA_CONFLICT', message: 'The file changed since you loaded it. Reload and try again.', status: deleteStatus }, deleteStatus);
          return json({ repo: REPO, action: 'delete', branch: 'main', path: 'docs/guide.md', commit: { sha: 'f'.repeat(40), html_url: 'https://github.com/ankworks/aurelia/commit/fff' } });
        }
        if (path === `/api/repos/${REPO}/files/move` && method === 'POST') {
          if (moveStatus !== 200) return json({ error: 'DESTINATION_EXISTS', message: '"docs/other.md" already exists on "main".', status: moveStatus }, moveStatus);
          return json({
            repo: REPO,
            action: 'move',
            branch: 'main',
            path: String(body.to ?? ''),
            from: String(body.from ?? ''),
            to: String(body.to ?? ''),
            files: [{ from: String(body.from ?? ''), to: String(body.to ?? '') }],
            commit: { sha: 'e'.repeat(40), html_url: 'https://github.com/ankworks/aurelia/commit/eee' },
            atomic: true,
            commits: 1,
          });
        }
        if (path === `/api/repos/${REPO}/files` && method === 'POST') {
          return json({
            repo: REPO,
            action: 'create',
            branch: String(body.newBranch ?? body.branch ?? 'main'),
            base_branch: String(body.branch ?? 'main'),
            path: String(body.path ?? ''),
            commit: { sha: 'a'.repeat(40), html_url: 'https://github.com/ankworks/aurelia/commit/aaa' },
            content: { sha: BLOB_SHA, path: String(body.path ?? '') },
          });
        }
      }

      return json({ error: 'NOT_FOUND', message: `Not in the test table: ${method} ${path}`, status: 404 }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
  }

  function open(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    );
  }

  beforeEach(() => {
    invalidateCache();
    clearExplorerCache();
    clearRepoPermissionsCache();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    window.confirm = vi.fn(() => true) as unknown as typeof window.confirm;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------

  describe('who sees the actions', () => {
    it('offers only read actions to an anonymous visitor', async () => {
      install('anonymous');
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      await screen.findByText('guide.md', { selector: 'span.font-mono.text-sm.text-text' });
      expect(screen.getByTestId('file-action-raw')).toBeTruthy();
      expect(screen.getByTestId('file-action-history')).toBeTruthy();
      expect(screen.queryByTestId('edit-file-button')).toBeNull();
      expect(screen.queryByTestId('file-action-rename')).toBeNull();
      expect(screen.queryByTestId('file-action-move')).toBeNull();
      expect(screen.queryByTestId('file-action-delete')).toBeNull();
    });

    it('offers nothing more to a signed-in non-member', async () => {
      install('non-member');
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      await screen.findByText('guide.md', { selector: 'span.font-mono.text-sm.text-text' });
      expect(screen.queryByTestId('file-action-delete')).toBeNull();
      expect(screen.queryByTestId('file-action-rename')).toBeNull();
    });

    it('offers nothing more to a member without write access', async () => {
      install('reader');
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      await screen.findByText('guide.md', { selector: 'span.font-mono.text-sm.text-text' });
      expect(screen.queryByTestId('file-action-delete')).toBeNull();
      expect(screen.queryByTestId('file-action-move')).toBeNull();
    });

    it('offers Edit, Rename, Move, and Delete to a member with write access', async () => {
      install('writer');
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      expect(await screen.findByTestId('edit-file-button')).toBeTruthy();
      expect(screen.getByTestId('file-action-rename')).toBeTruthy();
      expect(screen.getByTestId('file-action-move')).toBeTruthy();
      expect(screen.getByTestId('file-action-delete')).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------

  describe('delete', () => {
    it('requires typing the file name before it can be submitted', async () => {
      install('writer');
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      await userEvent.click(await screen.findByTestId('file-action-delete'));

      const dialog = await screen.findByTestId('delete-dialog');
      expect(dialog.textContent).toContain('docs/guide.md');
      expect(dialog.textContent).toContain('main');
      expect(dialog.textContent).toContain(BLOB_SHA.slice(0, 7));

      const submit = screen.getByTestId('delete-submit');
      expect(submit.hasAttribute('disabled')).toBe(true);

      await userEvent.type(screen.getByTestId('delete-confirm-input'), 'guide');
      expect(submit.hasAttribute('disabled')).toBe(true);

      await userEvent.type(screen.getByTestId('delete-confirm-input'), '.md');
      expect(submit.hasAttribute('disabled')).toBe(false);
    });

    it('sends the blob sha with the delete', async () => {
      install('writer');
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      await userEvent.click(await screen.findByTestId('file-action-delete'));
      await userEvent.type(await screen.findByTestId('delete-confirm-input'), 'guide.md');
      await userEvent.click(screen.getByTestId('delete-submit'));

      await waitFor(() => expect(writes.length).toBe(1));
      expect(writes[0]?.method).toBe('DELETE');
      expect(writes[0]?.path).toBe(`/api/repos/${REPO}/files`);
      expect(writes[0]?.body).toMatchObject({ path: 'docs/guide.md', branch: 'main', sha: BLOB_SHA });
      expect(typeof writes[0]?.body.message).toBe('string');
    });

    it('shows the server refusal instead of claiming success', async () => {
      install('writer');
      deleteStatus = 409;
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      await userEvent.click(await screen.findByTestId('file-action-delete'));
      await userEvent.type(await screen.findByTestId('delete-confirm-input'), 'guide.md');
      await userEvent.click(screen.getByTestId('delete-submit'));

      const dialog = screen.getByTestId('delete-dialog');
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(/changed since you loaded it/i);
      expect(screen.queryByTestId('file-action-result')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------

  describe('rename and move', () => {
    it('pre-fills the file name and shows the resulting path', async () => {
      install('writer');
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      await userEvent.click(await screen.findByTestId('file-action-rename'));

      const input = await screen.findByTestId('rename-path-input');
      expect((input as HTMLInputElement).value).toBe('guide.md');
      // The dialog works out the full path from the parent directory.
      expect(screen.getByTestId('rename-dialog').textContent).toContain('docs/guide.md');
    });

    it('refuses a name containing a slash', async () => {
      install('writer');
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      await userEvent.click(await screen.findByTestId('file-action-rename'));
      const input = await screen.findByTestId('rename-path-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'sub/name.md');

      expect(screen.getByTestId('rename-submit').hasAttribute('disabled')).toBe(true);
      expect(screen.getByTestId('rename-dialog').textContent).toMatch(/cannot contain/i);
    });

    it('refuses an identical name', async () => {
      install('writer');
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      await userEvent.click(await screen.findByTestId('file-action-rename'));
      expect(screen.getByTestId('rename-submit').hasAttribute('disabled')).toBe(true);
    });

    it('sends the rename as one move with the blob sha', async () => {
      install('writer');
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      await userEvent.click(await screen.findByTestId('file-action-rename'));
      const input = await screen.findByTestId('rename-path-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'handbook.md');
      await userEvent.click(screen.getByTestId('rename-submit'));

      await waitFor(() => expect(writes.length).toBe(1));
      expect(writes[0]?.method).toBe('POST');
      expect(writes[0]?.path).toBe(`/api/repos/${REPO}/files/move`);
      expect(writes[0]?.body).toMatchObject({
        from: 'docs/guide.md',
        to: 'docs/handbook.md',
        branch: 'main',
        sha: BLOB_SHA,
      });
    });

    it('moves to a new path and reports the resulting branch', async () => {
      install('writer');
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      await userEvent.click(await screen.findByTestId('file-action-move'));
      const input = await screen.findByTestId('move-path-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'handbook/guide.md');
      await userEvent.click(screen.getByTestId('move-submit'));

      await waitFor(() => expect(writes.length).toBe(1));
      expect(writes[0]?.body).toMatchObject({ from: 'docs/guide.md', to: 'handbook/guide.md' });
      // The server said one atomic commit; the UI reports the branch it landed on.
      expect(await screen.findByTestId('file-action-result')).toHaveTextContent('main');
    });

    it('surfaces a destination conflict', async () => {
      install('writer');
      moveStatus = 409;
      open(`/repos/${REPO}/blob/main/docs/guide.md`);
      await userEvent.click(await screen.findByTestId('file-action-move'));
      const input = await screen.findByTestId('move-path-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'docs/other.md');
      await userEvent.click(screen.getByTestId('move-submit'));

      const dialog = screen.getByTestId('move-dialog');
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already exists/i);
    });
  });

  // -------------------------------------------------------------------------

  describe('add file and create directory', () => {
    it('explains what is wrong with an invalid file name', async () => {
      install('writer');
      open(`/repos/${REPO}/new/main`);
      await userEvent.type(await screen.findByTestId('new-file-name'), 'bad/name.md');
      expect(await screen.findByTestId('new-file-name-error')).toHaveTextContent(/cannot contain/i);
      expect(screen.queryByLabelText('Source of bad/name.md')).toBeNull();
    });

    it('opens the editor for a valid file name', async () => {
      install('writer');
      open(`/repos/${REPO}/new/main`);
      await userEvent.type(await screen.findByTestId('new-file-name'), 'notes.md');
      expect(await screen.findByLabelText('Markdown source of notes.md')).toBeTruthy();
    });

    it('creates a directory by committing .gitkeep inside it', async () => {
      install('writer');
      open(`/repos/${REPO}/new/main?kind=dir`);
      await userEvent.type(await screen.findByTestId('new-file-name'), 'guides');
      const submit = await screen.findByTestId('create-directory-submit');

      const form = screen.getByTestId('directory-commit-message').closest('div')?.parentElement ?? document.body;
      expect(form.textContent).toMatch(/git tracks files, not directories/i);

      await userEvent.click(submit);
      await waitFor(() => expect(writes.length).toBe(1));
      expect(writes[0]?.method).toBe('POST');
      expect(writes[0]?.path).toBe(`/api/repos/${REPO}/files`);
      expect(writes[0]?.body).toMatchObject({ path: 'guides/.gitkeep', content: '', branch: 'main' });
    });

    it('explains that creating files requires write access', async () => {
      install('reader');
      open(`/repos/${REPO}/new/main`);
      await userEvent.type(await screen.findByTestId('new-file-name'), 'notes.md');
      expect(await screen.findByText(/Creating files requires write access/i)).toBeTruthy();
    });
  });
});
