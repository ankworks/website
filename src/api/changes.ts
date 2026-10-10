/**
 * Browser client for repository writes and compare (Milestone C).
 *
 * Write calls require a signed-in session (HttpOnly cookie) and push
 * permission — the Worker enforces both and fails closed.
 */

import type { CommitRequestBody, CommitResponse, CompareResponse, CreateBranchRequestBody, CreateBranchResponse } from '../types';
import { ExplorerApiError } from './explorer';

async function changesFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ExplorerApiError('Could not reach the repository service.', 0, 'NETWORK_ERROR');
  }
}

async function readError(response: Response): Promise<ExplorerApiError> {
  let message = 'The repository request failed.';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export const changesApi = {
  /** Commit one file to a branch (creates the file when `sha` is omitted). */
  async commit(repo: string, body: CommitRequestBody): Promise<CommitResponse> {
    const response = await changesFetch(`/api/repos/${encodeURIComponent(repo)}/commit`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await readError(response);
    const data: unknown = await response.json();
    if (!isRecord(data) || !isRecord(data.commit) || typeof data.commit.sha !== 'string') {
      throw new ExplorerApiError('The repository service returned an invalid payload.', 500, 'INVALID_RESPONSE');
    }
    return data as unknown as CommitResponse;
  },

  /** Create a branch from a start point (branch name or commit sha). */
  async createBranch(repo: string, body: CreateBranchRequestBody): Promise<CreateBranchResponse> {
    const response = await changesFetch(`/api/repos/${encodeURIComponent(repo)}/branches`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await readError(response);
    const data: unknown = await response.json();
    if (!isRecord(data) || typeof data.sha !== 'string') {
      throw new ExplorerApiError('The repository service returned an invalid payload.', 500, 'INVALID_RESPONSE');
    }
    return data as unknown as CreateBranchResponse;
  },

  /** Unified diff between two refs (read-only). */
  async compare(repo: string, base: string, head: string): Promise<CompareResponse> {
    const params = new URLSearchParams({ base, head });
    const response = await changesFetch(`/api/repos/${encodeURIComponent(repo)}/compare?${params.toString()}`);
    if (!response.ok) throw await readError(response);
    const data: unknown = await response.json();
    if (!isRecord(data) || !Array.isArray(data.files)) {
      throw new ExplorerApiError('The repository service returned an invalid payload.', 500, 'INVALID_RESPONSE');
    }
    return data as unknown as CompareResponse;
  },
};
