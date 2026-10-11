import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider } from '../auth/AuthContext';
import { CommentForm, IssueControls, PullRequestControls } from '../components/collaboration/DiscussionActions';
import { MEMBER } from './helpers/membership';

/** Milestone D UI: gated comment/issue/PR controls with truthful fallbacks. */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type FetchMock = ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

function sessionBody(authenticated: boolean) {
  return {
    authenticated,
    user: authenticated ? { id: 7, login: 'octocat', name: null, avatarUrl: '', htmlUrl: '' } : null,
    expiresAt: authenticated ? '2026-02-01T00:00:00.000Z' : null,
    authEnabled: true,
  };
}

function permissionsBody(overrides: Record<string, unknown> = {}) {
  return { owner: 'ankworks', repo: 'website', canRead: true, canWrite: false, canTriage: false, canAdmin: false, role: 'read', source: 'user-token', ...overrides };
}

describe('DiscussionActions', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function paths(): string[] {
    return fetchMock.mock.calls.map((call) => String(call[0]));
  }

  function stubSession(authenticated: boolean, permissions: Record<string, unknown>) {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/auth/session')) return json(sessionBody(authenticated));
      if (url.includes('/api/auth/permissions')) return json(permissionsBody(permissions));
      if (url.includes('/api/auth/membership')) return json(MEMBER({ login: authenticated ? 'octocat' : null, id: authenticated ? 7 : null }));
      return json({ number: 7, state: 'open', html_url: '', id: 1, merged: false, comment_id: 0, title: '' });
    });
  }

  it('shows a sign-in notice instead of the comment form when signed out', async () => {
    stubSession(false, {});
    render(<AuthProvider><CommentForm repo="website" number={7} /></AuthProvider>);
    await screen.findByText(/Sign in with GitHub/);
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
  });

  it('posts a comment when signed in', async () => {
    stubSession(true, {});
    render(<AuthProvider><CommentForm repo="website" number={7} /></AuthProvider>);
    const textarea = await screen.findByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Looks good' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(paths().some((p) => p === '/api/repos/website/issues/7/comments')).toBe(true));
    await screen.findByText(/Comment posted/);
  });

  it('closes an issue through the management controls', async () => {
    stubSession(true, { canTriage: true });
    render(<AuthProvider><IssueControls repo="website" number={7} state="open" labels={['bug']} /></AuthProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Close issue' }));
    await waitFor(() => expect(paths().some((p) => p === '/api/repos/website/issues/7')).toBe(true));
    const call = fetchMock.mock.calls.find((entry) => String(entry[0]).endsWith('/issues/7'));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ state: 'closed' });
    await screen.findByText(/Issue closed/);
  });

  it('explains missing triage access instead of showing issue controls', async () => {
    stubSession(true, { canTriage: false });
    render(<AuthProvider><IssueControls repo="website" number={7} state="open" labels={[]} /></AuthProvider>);
    await screen.findByText(/requires triage access/);
    expect(screen.queryByRole('button', { name: 'Close issue' })).toBeNull();
  });

  it('merges a pull request for users with write access', async () => {
    stubSession(true, { canWrite: true, canTriage: true });
    render(<AuthProvider><PullRequestControls repo="website" number={3} state="open" /></AuthProvider>);
    const merge = await screen.findByTestId('merge-button');
    fireEvent.click(merge);
    // V3-C: merging is irreversible, so it takes a second, explicit click and
    // the request carries `confirm: true` for the Worker to check.
    await screen.findByTestId('merge-confirm-prompt');
    expect(paths().some((p) => p === '/api/repos/website/pulls/3/merge')).toBe(false);
    fireEvent.click(screen.getByTestId('merge-confirm-button'));
    await waitFor(() => expect(paths().some((p) => p === '/api/repos/website/pulls/3/merge')).toBe(true));
    const call = fetchMock.mock.calls.find((entry) => String(entry[0]).endsWith('/merge'));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({ merge_method: 'squash', confirm: true });
    await screen.findByText(/Pull request merged/);
  });

  it('cancels a pending merge without calling GitHub', async () => {
    stubSession(true, { canWrite: true, canTriage: true });
    render(<AuthProvider><PullRequestControls repo="website" number={3} state="open" /></AuthProvider>);
    fireEvent.click(await screen.findByTestId('merge-button'));
    await screen.findByTestId('merge-confirm-button');
    fireEvent.click(screen.getByTestId('merge-cancel-button'));
    expect(screen.getByTestId('merge-button')).toBeTruthy();
    expect(paths().some((p) => p.endsWith('/merge'))).toBe(false);
  });

  it('submits an approval review', async () => {
    stubSession(true, { canTriage: true });
    render(<AuthProvider><PullRequestControls repo="website" number={3} state="open" /></AuthProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(paths().some((p) => p === '/api/repos/website/pulls/3/reviews')).toBe(true));
    await screen.findByText(/Review submitted \(APPROVE\)/);
  });

  it('hides merging from users without write access but keeps reviews', async () => {
    stubSession(true, { canWrite: false, canTriage: true });
    render(<AuthProvider><PullRequestControls repo="website" number={3} state="open" /></AuthProvider>);
    await screen.findByRole('button', { name: 'Approve' });
    expect(screen.queryByTestId('merge-button')).toBeNull();
    expect(screen.getByText(/Merging requires write access/)).toBeTruthy();
  });
});
