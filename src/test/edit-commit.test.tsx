import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import MarkdownEditor from '../components/explorer/MarkdownEditor';
import { MEMBER } from './helpers/membership';

/**
 * Milestone C commit UI: real commits behind sign-in + push permission,
 * optional new-branch creation, and truthful gate states.
 */

const SHA = 'c'.repeat(40);
const context = { repo: 'website', commitSha: SHA, baseDir: '' };
const TARGET = { repo: 'website', path: 'docs/guide.md', ref: 'main', blobSha: 'd'.repeat(40) };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type FetchMock = ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

describe('MarkdownEditor committing', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function requests(pathFragment: string): Array<{ url: string; init: RequestInit }> {
    return fetchMock.mock.calls
      .map((call) => ({ url: String(call[0]), init: (call[1] ?? {}) as RequestInit }))
      .filter((entry) => entry.url.includes(pathFragment));
  }

  function stubAuthedSession(canWrite: boolean) {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/session')) {
        return json({
          authenticated: true,
          user: { id: 7, login: 'octocat', name: null, avatarUrl: '', htmlUrl: 'https://github.com/octocat' },
          expiresAt: '2026-02-01T00:00:00.000Z',
          authEnabled: true,
        });
      }
      if (url.includes('/api/auth/permissions')) {
        return json({ owner: 'ankworks', repo: 'website', canRead: true, canWrite: canWrite, canTriage: canWrite, canAdmin: false, role: canWrite ? 'write' : 'read', source: 'user-token' });
      }
      if (url.includes('/api/auth/membership')) return json(MEMBER());
      if (url.includes('/api/auth/membership')) return json(MEMBER());
      return json({}, 404);
    });
  }

  function renderEditor() {
    return render(
      <MemoryRouter>
        <AuthProvider>
          <MarkdownEditor fileName="guide.md" initialContent={'# Guide\n\nhello\n'} context={context} target={TARGET} />
        </AuthProvider>
      </MemoryRouter>
    );
  }

  it('gates the commit button behind sign-in when signed out', async () => {
    fetchMock.mockResolvedValue(json({ authenticated: false, user: null, expiresAt: null, authEnabled: true }));
    renderEditor();
    const commit = screen.getByTestId('commit-button');
    await waitFor(() => expect(commit.getAttribute('title')).toMatch(/sign-in/i));
    expect(commit).toBeDisabled();
  });

  it('blocks committing without push access', async () => {
    stubAuthedSession(false);
    renderEditor();
    const commit = screen.getByTestId('commit-button');
    await waitFor(() => expect(commit.getAttribute('title')).toMatch(/write access/i));
    expect(commit).toBeDisabled();
  });

  it('commits the draft with message, branch, path, and blob sha', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/session')) {
        return json({ authenticated: true, user: { id: 7, login: 'octocat', name: null, avatarUrl: '', htmlUrl: 'https://github.com/octocat' }, expiresAt: '2026-02-01T00:00:00.000Z', authEnabled: true });
      }
      if (url.includes('/api/auth/permissions')) {
        return json({ owner: 'ankworks', repo: 'website', canRead: true, canWrite: true, canTriage: true, canAdmin: false, role: 'write', source: 'user-token' });
      }
      if (url.includes('/api/repos/website/commit')) {
        return json({
          branch: 'main',
          path: 'docs/guide.md',
          commit: { sha: 'a'.repeat(40), message: 'Fix guide', html_url: 'https://github.com/ankworks/website/commit/aaa' },
          content: { sha: 'b'.repeat(40), path: 'docs/guide.md' },
        });
      }
      if (url.includes('/api/auth/membership')) return json(MEMBER());
      return json({}, 404);
    });
    renderEditor();

    fireEvent.change(screen.getByLabelText('Markdown source of guide.md'), { target: { value: '# Guide\n\nupdated\n' } });
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'Fix guide' } });
    const commit = await screen.findByTestId('commit-button');
    await waitFor(() => expect(commit).toBeEnabled());
    fireEvent.click(commit);

    await waitFor(() => expect(requests('/api/repos/website/commit')).toHaveLength(1));
    const body = JSON.parse(String(requests('/api/repos/website/commit')[0].init.body)) as Record<string, string>;
    expect(body).toEqual({
      message: 'Fix guide',
      content: '# Guide\n\nupdated\n',
      branch: 'main',
      path: 'docs/guide.md',
      sha: 'd'.repeat(40),
    });
    await screen.findByText(/Committed to/);
  });

  it('creates a new branch when the branch field names one', async () => {
    const calls: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/api/auth/session')) {
        return json({ authenticated: true, user: { id: 7, login: 'octocat', name: null, avatarUrl: '', htmlUrl: '' }, expiresAt: null, authEnabled: true });
      }
      if (url.includes('/api/auth/permissions')) {
        return json({ owner: 'ankworks', repo: 'website', canRead: true, canWrite: true, canTriage: true, canAdmin: false, role: 'write', source: 'user-token' });
      }
      if (url.includes('/api/repos/website/branches')) {
        return json({ name: 'patch-1', sha: 'e'.repeat(40) });
      }
      if (url.includes('/api/repos/website/commit')) {
        return json({ branch: 'patch-1', path: 'docs/guide.md', commit: { sha: 'a'.repeat(40), message: 'x', html_url: '' }, content: { sha: 'b'.repeat(40), path: 'docs/guide.md' } });
      }
      if (url.includes('/api/auth/membership')) return json(MEMBER());
      return json({}, 404);
    });
    renderEditor();

    fireEvent.change(screen.getByLabelText('Markdown source of guide.md'), { target: { value: '# changed\n' } });
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText('Target branch (type a new name to create it)'), { target: { value: 'patch-1' } });
    const commit = await screen.findByTestId('commit-button');
    await waitFor(() => expect(commit).toBeEnabled());
    fireEvent.click(commit);

    await waitFor(() => expect(calls.some((url) => url.includes('/branches'))).toBe(true));
    await waitFor(() => expect(calls.some((url) => url.includes('/commit'))).toBe(true));
    const branchBody = JSON.parse(String(requests('/api/repos/website/branches')[0].init.body)) as Record<string, string>;
    expect(branchBody).toEqual({ name: 'patch-1', from: 'main' });
  });

  it('surfaces commit failures', async () => {
    stubAuthedSession(true);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/session')) {
        return json({ authenticated: true, user: { id: 7, login: 'octocat', name: null, avatarUrl: '', htmlUrl: '' }, expiresAt: null, authEnabled: true });
      }
      if (url.includes('/api/auth/permissions')) {
        return json({ owner: 'ankworks', repo: 'website', canRead: true, canWrite: true, canTriage: true, canAdmin: false, role: 'write', source: 'user-token' });
      }
      if (url.includes('/api/auth/membership')) return json(MEMBER());
      return json({ error: 'CONFLICT', message: 'The branch changed while you were editing.', status: 409 }, 409);
    });
    renderEditor();
    fireEvent.change(screen.getByLabelText('Markdown source of guide.md'), { target: { value: '# changed\n' } });
    fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'x' } });
    fireEvent.click(await screen.findByTestId('commit-button'));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toMatch(/branch changed/i);
  });
});
