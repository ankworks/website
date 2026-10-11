/**
 * Browser client for collaboration writes (Milestone D).
 *
 * All calls require a signed-in session (HttpOnly cookie); the Worker verifies
 * repository permissions and fails closed.
 */

import { ExplorerApiError } from './explorer';

export interface CollabWriteResult {
  number: number;
  state: string;
  html_url: string;
  title: string;
  merged: boolean;
  comment_id: number;
  id: number;
}

export interface CreateIssueInput {
  title: string;
  body?: string;
  labels?: string[];
}

export interface UpdateIssueInput {
  title?: string;
  state?: 'open' | 'closed';
  labels?: string[];
  body?: string;
  state_reason?: 'completed' | 'not_planned';
  assignees?: string[];
  milestone?: number | null;
}

export interface UpdatePullInput {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  base?: string;
}

export interface CreatePullInput {
  title: string;
  head: string;
  base: string;
  body?: string;
}

export interface SubmitReviewInput {
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
  body?: string;
}

async function writeFetch(path: string, method: string, payload: unknown): Promise<Response> {
  try {
    return await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new ExplorerApiError('Could not reach the collaboration service.', 0, 'NETWORK_ERROR');
  }
}

async function readError(response: Response): Promise<ExplorerApiError> {
  let message = 'The collaboration request failed.';
  let code = 'REQUEST_FAILED';
  try {
    const body = (await response.json()) as { error?: string; message?: string };
    if (typeof body.message === 'string' && body.message) message = body.message;
    if (typeof body.error === 'string' && body.error) code = body.error;
  } catch {
    // Keep the generic message when the error body is not JSON.
  }
  return new ExplorerApiError(message, response.status, code);
}

async function readResult(response: Response): Promise<CollabWriteResult> {
  if (!response.ok) throw await readError(response);
  const data: unknown = await response.json();
  if (data === null || typeof data !== 'object' || typeof (data as { number?: unknown }).number !== 'number') {
    throw new ExplorerApiError('The collaboration service returned an invalid payload.', 500, 'INVALID_RESPONSE');
  }
  return data as CollabWriteResult;
}

const enc = encodeURIComponent;

export const collabWrites = {
  createIssue(repo: string, input: CreateIssueInput): Promise<CollabWriteResult> {
    return writeFetch(`/api/repos/${enc(repo)}/issues`, 'POST', input).then(readResult);
  },

  commentOnIssue(repo: string, number: number, body: string): Promise<CollabWriteResult> {
    return writeFetch(`/api/repos/${enc(repo)}/issues/${number}/comments`, 'POST', { body }).then(readResult);
  },

  updateIssue(repo: string, number: number, input: UpdateIssueInput): Promise<CollabWriteResult> {
    return writeFetch(`/api/repos/${enc(repo)}/issues/${number}`, 'PATCH', input).then(readResult);
  },

  createPull(repo: string, input: CreatePullInput): Promise<CollabWriteResult> {
    return writeFetch(`/api/repos/${enc(repo)}/pulls`, 'POST', input).then(readResult);
  },

  submitReview(repo: string, number: number, input: SubmitReviewInput): Promise<CollabWriteResult> {
    return writeFetch(`/api/repos/${enc(repo)}/pulls/${number}/reviews`, 'POST', input).then(readResult);
  },

  /**
   * Merge a pull request. `confirm` is required: the Worker refuses a merge
   * that was not explicitly confirmed, so a stray click or a replayed request
   * cannot merge anything.
   */
  mergePull(repo: string, number: number, mergeMethod: 'merge' | 'squash' | 'rebase'): Promise<CollabWriteResult> {
    return writeFetch(`/api/repos/${enc(repo)}/pulls/${number}/merge`, 'PUT', {
      merge_method: mergeMethod,
      confirm: true,
    }).then(readResult);
  },

  updatePull(repo: string, number: number, input: UpdatePullInput): Promise<CollabWriteResult> {
    return writeFetch(`/api/repos/${enc(repo)}/pulls/${number}`, 'PATCH', input).then(readResult);
  },

  editComment(repo: string, commentId: number, body: string): Promise<CollabWriteResult> {
    return writeFetch(`/api/repos/${enc(repo)}/comments/${commentId}`, 'PATCH', { body }).then(readResult);
  },

  deleteComment(repo: string, commentId: number): Promise<{ deleted: boolean; id: number }> {
    return writeFetch(`/api/repos/${enc(repo)}/comments/${commentId}`, 'DELETE', {}).then(async (response) => {
      if (!response.ok) throw await readError(response);
      return (await response.json()) as { deleted: boolean; id: number };
    });
  },
};
