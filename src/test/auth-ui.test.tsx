import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../auth/AuthContext';
import AuthMenu from '../components/AuthMenu';

/**
 * Milestone B UI: sign-in link, account menu, sign-out, and fail-closed
 * degradation when the auth service is unavailable or unconfigured.
 */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sessionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authenticated: true,
    user: { id: 7, login: 'octocat', name: 'Octo Cat', avatarUrl: 'https://avatars.githubusercontent.com/u/7', htmlUrl: 'https://github.com/octocat' },
    expiresAt: '2026-02-01T00:00:00.000Z',
    authEnabled: true,
    ...overrides,
  };
}

describe('AuthMenu', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function renderMenu() {
    return render(
      <AuthProvider>
        <AuthMenu />
      </AuthProvider>
    );
  }

  function paths(): string[] {
    return fetchMock.mock.calls.map((call) => String(call[0]));
  }

  it('shows a skeleton while the session loads', async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { release = resolve; }));
    renderMenu();
    expect(screen.getByTestId('auth-menu-skeleton')).toBeTruthy();
    release(json({ authenticated: false, user: null, expiresAt: null, authEnabled: true }));
    await waitFor(() => expect(screen.queryByTestId('auth-menu-skeleton')).toBeNull());
  });

  it('renders the GitHub sign-in link when signed out and auth is enabled', async () => {
    fetchMock.mockResolvedValueOnce(json({ authenticated: false, user: null, expiresAt: null, authEnabled: true }));
    renderMenu();
    const link = await screen.findByTestId('sign-in-link');
    expect(link.getAttribute('href')).toBe('/api/auth/login');
    expect(link.textContent).toContain('Sign in with GitHub');
  });

  it('renders nothing actionable when auth is not configured', async () => {
    fetchMock.mockResolvedValueOnce(json({ authenticated: false, user: null, expiresAt: null, authEnabled: false }));
    renderMenu();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('sign-in-link')).toBeNull();
    expect(screen.queryByTestId('auth-menu')).toBeNull();
    expect(screen.queryByTestId('auth-menu-skeleton')).toBeNull();
  });

  it('renders the account menu for a signed-in user', async () => {
    fetchMock.mockResolvedValueOnce(json(sessionBody()));
    renderMenu();
    const summary = await screen.findByLabelText('Account menu for octocat');
    expect(summary.textContent).toContain('octocat');
    expect(screen.getByText('Signed in as')).toBeTruthy();
  });

  it('signs out and falls back to the sign-in link', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('logout')) return json({ ok: true });
      return json(paths().filter((p) => p.includes('logout')).length > 0
        ? { authenticated: false, user: null, expiresAt: null, authEnabled: true }
        : sessionBody());
    });
    renderMenu();
    const button = await screen.findByTestId('sign-out-button');
    await userEvent.click(button);
    expect(paths().some((p) => p === '/api/auth/logout')).toBe(true);
    await screen.findByTestId('sign-in-link');
  });

  it('degrades to signed-out when the session service fails (fail closed)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    renderMenu();
    const link = await screen.findByTestId('sign-in-link');
    expect(link.getAttribute('href')).toBe('/api/auth/login');
  });
});
