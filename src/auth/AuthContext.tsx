/**
 * React context for the signed-in user session.
 *
 * The session itself lives in an HttpOnly cookie; this context only mirrors the
 * non-sensitive fields returned by `GET /api/auth/session`. A failed lookup
 * degrades to "anonymous" (fail closed) instead of breaking the app.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi } from '../api/auth';
import { clearRepoPermissionsCache } from '../lib/repo-permissions-cache';
import type { AuthUser } from '../types/auth';

export interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: AuthUser | null;
  /** False when the Worker has no GitHub App credentials configured. */
  authEnabled: boolean;
  expiresAt: string | null;
}

export interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const ANONYMOUS: AuthState = { status: 'anonymous', user: null, authEnabled: true, expiresAt: null };

const AuthContext = createContext<AuthContextValue>({
  ...ANONYMOUS,
  status: 'loading',
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...ANONYMOUS, status: 'loading' });

  const refresh = useCallback(async () => {
    // Permission answers belong to a session: drop them before re-reading it so
    // a sign-in or sign-out can never be served another user's cached rights.
    clearRepoPermissionsCache();
    try {
      const session = await authApi.session();
      setState({
        status: session.authenticated ? 'authenticated' : 'anonymous',
        user: session.user,
        authEnabled: session.authEnabled,
        expiresAt: session.expiresAt,
      });
    } catch {
      // Fail closed: an unreachable or invalid auth service means "signed out".
      setState({ ...ANONYMOUS });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthContextValue>(() => ({ ...state, refresh, logout }), [state, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
