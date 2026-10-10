import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { invalidateCache } from '../api/github';
import { clearExplorerCache } from '../api/explorer';
import { clearRepoPermissionsCache } from '../lib/repo-permissions-cache';

/**
 * Authenticated write UI, end to end through the real route table.
 *
 * The regression this suite guards: a signed-in owner with admin rights on the
 * repository saw no way to edit a file and no way to open an issue, while the
 * page kept advertising the (disabled) guest queue. Every case below asserts
 * what a viewer actually gets for their *verified* permission level:
 *
 *   admin      → Edit control in the file viewer, enabled commit, issue composer
 *   read-only  → no Edit shortcut, commit blocked with a truthful reason,
 *                issue composer still available (GitHub needs only read access)
 *   anonymous  → no Edit shortcut, commit gated behind sign-in, sign-in prompt
 *                instead of a dead issue form, guest queue still offered
 *
 * Nothing here weakens authorization: the Worker re-verifies every write with
 * the user's own token. These tests only assert the UI stops hiding controls
 * the backend already allows.
 */

const BLOB_SHA = 'd'.repeat(40);
const COMMIT_SHA = 'c'.repeat(40);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type FetchMock = ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

type Viewer = 'admin' | 'read' | 'anonymous';

const SESSIONS: Record<Viewer, Record<string, unknown>> = {
  admin: {
    authenticated: true,
    user: { id: 1, login: 'ankbuitv', name: null, avatarUrl: '', htmlUrl: 'https://github.com/ankbuitv' },
    expiresAt: '2027-01-01T00:00:00.000Z',
    authEnabled: true,
  },
  read: {
    authenticated: true,
    user: { id: 2, login: 'reader', name: null, avatarUrl: '', htmlUrl: 'https://github.com/reader' },
    expiresAt: '2027-01-01T00:00:00.000Z',
    authEnabled: true,
  },
  anonymous: { authenticated: false, user: null, expiresAt: null, authEnabled: true },
};

function permissionsFor(viewer: Viewer): Record<string, unknown> {
  if (viewer === 'admin') {
    return { owner: 'ankworks', repo: 'website', canRead: true, canWrite: true, canTriage: true, canAdmin: true, role: 'admin', source: 'user-token' };
  }
  return { owner: 'ankworks', repo: 'website', canRead: true, canWrite: false, canTriage: false, canAdmin: false, role: 'read', source: 'user-token' };
}

const REPO_DETAIL = {
  repo: {
    id: 1,
    name: 'website',
    full_name: 'ankworks/website',
    private: false,
    html_url: 'https://github.com/ankworks/website',
    description: 'AnkWorks website',
    language: 'TypeScript',
    stargazers_count: 3,
    forks_count: 1,
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
    repo: 'website',
    ref: 'main',
    commit_sha: COMMIT_SHA,
    path,
    name: path.split('/').pop() ?? path,
    kind: 'text',
    size: content.length,
    blob_sha: BLOB_SHA,
    html_url: `https://github.com/ankworks/website/blob/main/${path}`,
    content,
    target: null,
    submodule_url: null,
  };
}

describe('authenticated write UI', () => {
  let fetchMock: FetchMock;
  let writes: Array<{ url: string; init: RequestInit }>;

  function install(viewer: Viewer, options: { issuesEnabled?: boolean } = {}) {
    writes = [];
    const detail = { repo: { ...REPO_DETAIL.repo, has_issues: options.issuesEnabled ?? true } };
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async (input, init) => {
      const url = new URL(String(input), 'https://site.test');
      const method = (init?.method ?? 'GET').toUpperCase();
      const path = url.pathname;

      if (path === '/api/auth/session') return json(SESSIONS[viewer]);
      if (path === '/api/auth/permissions') {
        if (viewer === 'anonymous') return json({ error: 'UNAUTHENTICATED', message: 'Sign in to detect repository permissions.', status: 401 }, 401);
        return json(permissionsFor(viewer));
      }
      if (path === '/api/repos') {
        return json({ org: 'ankworks', repos: [REPO_DETAIL.repo], total_count: 1, fetched_at: '2026-01-01T00:00:00Z' });
      }
      if (path === '/api/repos/website' && method === 'GET') return json(detail);
      if (path === '/api/repos/website/file') {
        const requested = url.searchParams.get('path') ?? '';
        if (requested === 'docs/guide.md') return json(fileBody('docs/guide.md', '# Guide\n\nhello\n'));
        if (requested === 'src/app.ts') return json(fileBody('src/app.ts', 'export const value = 1;\n'));
        return json({ error: 'PATH_NOT_FOUND', message: 'Not found.', status: 404 }, 404);
      }
      if (path === '/api/repos/website/issues' && method === 'GET') {
        return json({ items: [], total_count: 0, state: 'open', page: 1, per_page: 30, has_next: false });
      }
      if (path === '/api/guest/config') return json({ enabled: false, siteKey: null });

      // Every write is recorded so the assertions can inspect method + body.
      if (method !== 'GET') {
        writes.push({ url: `${path}${url.search}`, init: (init ?? {}) as RequestInit });
        if (path === '/api/repos/website/commit') {
          return json({
            branch: 'main',
            path: 'docs/guide.md',
            commit: { sha: 'a'.repeat(40), message: 'Update', html_url: 'https://github.com/ankworks/website/commit/aaa' },
            content: { sha: 'b'.repeat(40), path: 'docs/guide.md' },
          });
        }
        if (path === '/api/repos/website/issues') {
          return json({ number: 42, state: 'open', html_url: 'https://github.com/ankworks/website/issues/42', title: 'x', merged: false, comment_id: 0, id: 99 });
        }
      }
      return json({ error: 'NOT_FOUND', message: 'Not in the test table.', status: 404 }, 404);
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
  // File editing + commit gating
  // -------------------------------------------------------------------------

  describe('file editing', () => {
    it('offers the Edit control and an enabled commit for an admin', async () => {
      install('admin');
      open('/repos/website/blob/main/docs/guide.md');

      const edit = await screen.findByTestId('edit-file-button');
      expect(edit.getAttribute('href')).toBe('/repos/website/blob/main/docs/guide.md?view=edit');

      await userEvent.click(edit);
      const source = await screen.findByLabelText('Markdown source of guide.md');
      fireEvent.change(source, { target: { value: '# Guide\n\nupdated\n' } });
      fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Update guide' } });

      const commit = await screen.findByTestId('commit-button');
      await waitFor(() => expect(commit).toBeEnabled());
      await userEvent.click(commit);

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0].url).toBe('/api/repos/website/commit');
      expect(writes[0].init.method).toBe('POST');
      expect(JSON.parse(String(writes[0].init.body))).toEqual({
        message: 'Update guide',
        content: '# Guide\n\nupdated\n',
        branch: 'main',
        path: 'docs/guide.md',
        sha: BLOB_SHA,
      });
      await screen.findByText(/Committed to/);
    });

    it('edits non-Markdown text files through the same commit workspace', async () => {
      install('admin');
      open('/repos/website/blob/main/src/app.ts?view=edit');

      const source = await screen.findByLabelText('Source of app.ts');
      fireEvent.change(source, { target: { value: 'export const value = 2;\n' } });
      fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Bump value' } });

      const commit = await screen.findByTestId('commit-button');
      await waitFor(() => expect(commit).toBeEnabled());
      await userEvent.click(commit);

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(JSON.parse(String(writes[0].init.body))).toMatchObject({
        path: 'src/app.ts',
        content: 'export const value = 2;\n',
        branch: 'main',
      });
    });

    it('hides the Edit shortcut from a read-only user and blocks their commit', async () => {
      install('read');
      open('/repos/website/blob/main/docs/guide.md');

      await screen.findByRole('tab', { name: 'Preview' });
      await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/auth/permissions'))).toBe(true));
      expect(screen.queryByTestId('edit-file-button')).toBeNull();

      // The Edit mode stays reachable; only the commit is gated, truthfully.
      await userEvent.click(screen.getByRole('tab', { name: 'Edit' }));
      const commit = await screen.findByTestId('commit-button');
      await waitFor(() => expect(commit.getAttribute('title')).toMatch(/requires write access to ankworks\/website/i));
      expect(commit).toBeDisabled();
    });

    it('gates the commit behind sign-in for an anonymous visitor', async () => {
      install('anonymous');
      open('/repos/website/blob/main/docs/guide.md');

      await screen.findByRole('tab', { name: 'Preview' });
      expect(screen.queryByTestId('edit-file-button')).toBeNull();

      await userEvent.click(screen.getByRole('tab', { name: 'Edit' }));
      const commit = await screen.findByTestId('commit-button');
      await waitFor(() => expect(commit.getAttribute('title')).toMatch(/requires sign-in/i));
      expect(commit).toBeDisabled();
    });
  });

  // -------------------------------------------------------------------------
  // New issue navigation + creation
  // -------------------------------------------------------------------------

  describe('new issue', () => {
    it('links the issue list to the composer and creates an issue for an admin', async () => {
      install('admin');
      open('/repos/website/issues');

      const link = await screen.findByTestId('new-issue-link');
      expect(link.getAttribute('href')).toBe('/repos/website/issues/new');

      await userEvent.click(link);
      const form = await screen.findByTestId('new-issue-form');
      fireEvent.change(within(form).getByLabelText('Issue title'), { target: { value: 'Broken build' } });
      fireEvent.change(within(form).getByLabelText('Issue description'), { target: { value: 'Steps to reproduce…' } });
      fireEvent.change(within(form).getByLabelText('Labels (comma separated)'), { target: { value: 'bug, help wanted' } });

      await userEvent.click(within(form).getByTestId('new-issue-submit'));

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0].url).toBe('/api/repos/website/issues');
      expect(writes[0].init.method).toBe('POST');
      expect(JSON.parse(String(writes[0].init.body))).toEqual({
        title: 'Broken build',
        body: 'Steps to reproduce…',
        labels: ['bug', 'help wanted'],
      });
      await screen.findByTestId('new-issue-created');
    });

    it('lets a read-only user open an issue (GitHub needs only read access)', async () => {
      install('read');
      open('/repos/website/issues/new');

      const form = await screen.findByTestId('new-issue-form');
      fireEvent.change(within(form).getByLabelText('Issue title'), { target: { value: 'Docs typo' } });
      await userEvent.click(within(form).getByTestId('new-issue-submit'));

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0].url).toBe('/api/repos/website/issues');
      await screen.findByTestId('new-issue-created');
    });

    it('routes /issues/new to the composer, not to an issue detail', async () => {
      install('admin');
      open('/repos/website/issues/new');
      await screen.findByTestId('new-issue-form');
      expect(screen.queryByText(/Invalid issue number/i)).toBeNull();
    });

    it('prompts an anonymous visitor to sign in instead of showing a dead form', async () => {
      install('anonymous');
      open('/repos/website/issues/new');

      await screen.findByTestId('new-issue-signin');
      expect(screen.queryByTestId('new-issue-form')).toBeNull();
      const prompt = screen.getByTestId('new-issue-signin');
      expect(within(prompt).getByRole('link', { name: /Sign in with GitHub/i }).getAttribute('href')).toBe('/api/auth/login');
    });

    it('explains a repository that has GitHub Issues turned off', async () => {
      // ankworks/website really has has_issues: false; GitHub answers 410 there,
      // so the composer must say so instead of offering a form that cannot work.
      install('admin', { issuesEnabled: false });
      open('/repos/website/issues');

      await screen.findByRole('heading', { name: 'Issues', level: 2 });
      expect(screen.queryByTestId('new-issue-link')).toBeNull();
    });

    it('replaces the composer with a truthful notice when issues are disabled', async () => {
      install('admin', { issuesEnabled: false });
      open('/repos/website/issues/new');

      await screen.findByTestId('new-issue-disabled');
      expect(screen.queryByTestId('new-issue-form')).toBeNull();
      expect(screen.getByText(/has turned GitHub Issues off/i)).toBeTruthy();
    });

    it('keeps the guest queue available, but secondary, on the organization page', async () => {
      install('anonymous');
      open('/issues');

      // The authenticated path is offered first…
      await screen.findByTestId('new-issue-signin');
      // …and the disabled guest queue degrades to a compact note, not a form.
      await screen.findByTestId('guest-form-disabled');
      expect(screen.queryByRole('button', { name: /Submit for review/i })).toBeNull();
      // The org-level composer link points at the on-page composer anchor.
      expect(screen.getByTestId('new-issue-link').getAttribute('href')).toBe('#new-issue');
    });

    it('offers a repository picker when opening an issue org-wide', async () => {
      install('admin');
      open('/issues');

      const form = await screen.findByTestId('new-issue-form');
      const select = await within(form).findByTestId('new-issue-repo-select');
      await userEvent.selectOptions(select, 'website');
      fireEvent.change(within(form).getByLabelText('Issue title'), { target: { value: 'Org-wide report' } });
      await userEvent.click(within(form).getByTestId('new-issue-submit'));

      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0].url).toBe('/api/repos/website/issues');
    });
  });
});
