/**
 * V3-B — organization-only write UI.
 *
 * The server re-verifies membership before every mutation (see
 * `worker-authorization.test.ts`). These tests cover the half the server cannot
 * cover: that the UI never offers a write control to a guest or to a signed-in
 * user whose membership is not verified, and that it says why instead of
 * silently hiding the control.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../auth/AuthContext';
import NewIssueForm from '../components/collaboration/NewIssueForm';
import WriteAccessNotice from '../components/collaboration/WriteAccessNotice';
import { GUEST, MEMBER, NON_MEMBER, UNVERIFIABLE } from './helpers/membership';
import type { MembershipResponse } from '../shared/membership';

const SESSION = {
  authenticated: true,
  user: { id: 7, login: 'octocat', name: null, avatarUrl: '', htmlUrl: 'https://github.com/octocat' },
  expiresAt: '2027-01-01T00:00:00.000Z',
  authEnabled: true,
};

const ANONYMOUS_SESSION = { authenticated: false, user: null, expiresAt: null, authEnabled: true };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Options {
  session?: Record<string, unknown>;
  membership?: MembershipResponse;
  membershipStatus?: number;
}

function stub(options: Options = {}) {
  const { session = SESSION, membership = MEMBER(), membershipStatus = 200 } = options;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/auth/session')) return json(session);
    if (url.includes('/api/auth/membership')) return json(membership, membershipStatus);
    if (url.includes('/api/auth/permissions')) {
      if (!session.authenticated) return json({ error: 'UNAUTHENTICATED', message: 'Sign in.', status: 401 }, 401);
      return json({ owner: 'ankworks', repo: 'website', canRead: true, canWrite: true, canTriage: true, canAdmin: false, role: 'write', source: 'user-token' });
    }
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('V3-B membership-gated write UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('NewIssueForm', () => {
    it('offers the composer to a verified member', async () => {
      stub({ membership: MEMBER() });
      render(
        <MemoryRouter>
          <AuthProvider>
            <NewIssueForm repo="website" issuesEnabled />
          </AuthProvider>
        </MemoryRouter>
      );
      expect(await screen.findByTestId('new-issue-form')).toBeTruthy();
      expect(screen.queryByTestId('new-issue-members-only')).toBeNull();
    });

    it('refuses the composer to a signed-in non-member and explains why', async () => {
      stub({ membership: NON_MEMBER() });
      render(
        <MemoryRouter>
          <AuthProvider>
            <NewIssueForm repo="website" issuesEnabled />
          </AuthProvider>
        </MemoryRouter>
      );
      expect(await screen.findByTestId('new-issue-members-only')).toBeTruthy();
      expect(screen.queryByTestId('new-issue-form')).toBeNull();
      expect(screen.getByText(/members only/i)).toBeTruthy();
    });

    it('refuses the composer when membership cannot be verified (fail closed)', async () => {
      stub({ membership: UNVERIFIABLE() });
      render(
        <MemoryRouter>
          <AuthProvider>
            <NewIssueForm repo="website" issuesEnabled />
          </AuthProvider>
        </MemoryRouter>
      );
      expect(await screen.findByTestId('new-issue-members-only')).toBeTruthy();
      expect(screen.queryByTestId('new-issue-form')).toBeNull();
    });

    it('still asks guests to sign in', async () => {
      stub({ session: ANONYMOUS_SESSION, membership: GUEST() });
      render(
        <MemoryRouter>
          <AuthProvider>
            <NewIssueForm repo="website" issuesEnabled />
          </AuthProvider>
        </MemoryRouter>
      );
      expect(await screen.findByText(/sign in with github/i)).toBeTruthy();
      expect(screen.queryByTestId('new-issue-members-only')).toBeNull();
    });
  });

  describe('WriteAccessNotice', () => {
    it('explains sign-in for guests', async () => {
      stub({ session: ANONYMOUS_SESSION, membership: GUEST() });
      render(
        <AuthProvider>
          <WriteAccessNotice action="comment on issues" />
        </AuthProvider>
      );
      expect(await screen.findByText(/sign in required/i)).toBeTruthy();
      expect(screen.getByText(/comment on issues/)).toBeTruthy();
    });

    it('explains member-only writes for signed-in non-members', async () => {
      stub({ membership: NON_MEMBER() });
      render(
        <AuthProvider>
          <WriteAccessNotice action="open a pull request" />
        </AuthProvider>
      );
      expect(await screen.findByText(/members only/i)).toBeTruthy();
    });

    it('distinguishes an unverifiable membership from a real non-membership', async () => {
      stub({ membership: UNVERIFIABLE() });
      render(
        <AuthProvider>
          <WriteAccessNotice />
        </AuthProvider>
      );
      expect((await screen.findAllByText(/could not be verified/i)).length).toBeGreaterThan(0);
    });

    it('explains repository permission for members who lack it', async () => {
      stub({ membership: MEMBER() });
      render(
        <AuthProvider>
          <WriteAccessNotice requireWrite />
        </AuthProvider>
      );
      expect(await screen.findByText(/insufficient repository permission/i)).toBeTruthy();
    });

    it('renders nothing for a member when no write permission is required', async () => {
      stub({ membership: MEMBER() });
      const { container } = render(
        <AuthProvider>
          <WriteAccessNotice requireWrite={false} />
        </AuthProvider>
      );
      await waitFor(() => expect(container.textContent?.trim()).toBe(''));
    });
  });

  describe('membership request shape', () => {
    beforeEach(() => {
      vi.unstubAllGlobals();
    });

    it('asks the Worker (never a client-side guess) and is not cached across users', async () => {
      const fetchMock = stub({ membership: MEMBER() });
      render(
        <AuthProvider>
          <WriteAccessNotice requireWrite={false} />
        </AuthProvider>
      );
      await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).includes('/api/auth/membership'))).toBe(true));
      const call = fetchMock.mock.calls.find((entry) => String(entry[0]).includes('/api/auth/membership'));
      expect(call).toBeTruthy();
      expect(String(call?.[0])).toMatch(/\/api\/auth\/membership$/);
    });
  });
});
