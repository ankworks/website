/**
 * Repository permission detection for the signed-in user.
 *
 * This is the single source of truth the write UI uses to decide whether a
 * control is offered. It is *advisory only*: the Worker re-verifies the same
 * permission with the user's own token before every write and fails closed.
 * The UI never widens access — it only avoids showing controls that the
 * backend would refuse.
 *
 * Fail closed:
 * - signed out            → every flag false, `loaded` true, no error
 * - lookup in flight      → every flag false, `loading` true
 * - lookup failed / 404   → every flag false, `error` explains it
 */

import { useEffect, useState } from 'react';
import { authApi } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { readCachedPermissions, writeCachedPermissions } from '../lib/repo-permissions-cache';
import { ORG_NAME } from '../shared/validation';
import type { AuthPermissionsResponse, RepoRole } from '../types/auth';

export interface RepoPermissions {
  /** True once a definitive answer is known (including "signed out"). */
  loaded: boolean;
  /** True while the lookup is in flight for a signed-in user. */
  loading: boolean;
  canWrite: boolean;
  canTriage: boolean;
  canAdmin: boolean;
  role: RepoRole | null;
  /** Human-readable reason when detection could not be completed. */
  error: string | null;
}

const NONE: RepoPermissions = {
  loaded: true,
  loading: false,
  canWrite: false,
  canTriage: false,
  canAdmin: false,
  role: null,
  error: null,
};

const PENDING: RepoPermissions = { ...NONE, loaded: false, loading: true };

function fromResponse(value: AuthPermissionsResponse): RepoPermissions {
  return {
    loaded: true,
    loading: false,
    canWrite: value.canWrite,
    canTriage: value.canTriage,
    canAdmin: value.canAdmin,
    role: value.role,
    error: null,
  };
}

/**
 * Permissions of the signed-in user on `ankworks/:repo`.
 *
 * Pass `null` (or an invalid repository name) to opt out: the result is the
 * signed-out shape and no request is made.
 */
export function useRepoPermissions(repo: string | null): RepoPermissions {
  const { status, user } = useAuth();
  const [state, setState] = useState<RepoPermissions>(NONE);

  useEffect(() => {
    if (!repo || status !== 'authenticated' || !user) {
      setState(NONE);
      return undefined;
    }

    const cached = readCachedPermissions(user.login, repo);
    if (cached) {
      setState(fromResponse(cached));
      return undefined;
    }

    let cancelled = false;
    setState(PENDING);
    authApi
      .permissions(ORG_NAME, repo)
      .then((value) => {
        writeCachedPermissions(user.login, repo, value);
        if (!cancelled) setState(fromResponse(value));
      })
      .catch(() => {
        // Fail closed: an unverifiable repository grants nothing in the UI.
        if (!cancelled) setState({ ...NONE, error: 'Could not verify repository permissions.' });
      });

    return () => {
      cancelled = true;
    };
  }, [repo, status, user]);

  return state;
}
