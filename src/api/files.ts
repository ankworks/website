/**
 * Browser client for file management (Directive C).
 *
 * Every call requires a signed-in session (HttpOnly cookie) and real push
 * permission. The Worker re-verifies both with the user's own token and fails
 * closed; these helpers only carry the request and surface the error the
 * Worker chose, so no UI has to invent a message for a refusal.
 */

import { ExplorerApiError } from './explorer';
import type {
  FileCreateRequestBody,
  FileDeleteRequestBody,
  FileMoveRequestBody,
  FileMutationResponse,
} from '../types';

async function filesFetch(path: string, init: RequestInit = {}): Promise<Response> {
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
  let message = 'The file operation failed.';
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

async function parseMutation(response: Response): Promise<FileMutationResponse> {
  if (!response.ok) throw await readError(response);
  const data: unknown = await response.json();
  if (!isRecord(data) || !isRecord(data.commit) || typeof data.commit.sha !== 'string') {
    throw new ExplorerApiError('The repository service returned an invalid payload.', 500, 'INVALID_RESPONSE');
  }
  return data as unknown as FileMutationResponse;
}

export const filesApi = {
  /** Create (or, with `sha`, replace) a file on a branch. */
  async create(repo: string, body: FileCreateRequestBody): Promise<FileMutationResponse> {
    const response = await filesFetch(`/api/repos/${encodeURIComponent(repo)}/files`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return parseMutation(response);
  },

  /** Delete one file, verified against the blob sha the UI loaded. */
  async remove(repo: string, body: FileDeleteRequestBody): Promise<FileMutationResponse> {
    const response = await filesFetch(`/api/repos/${encodeURIComponent(repo)}/files`, {
      method: 'DELETE',
      body: JSON.stringify(body),
    });
    return parseMutation(response);
  },

  /** Rename or move a file (or a whole directory) in one atomic commit. */
  async move(repo: string, body: FileMoveRequestBody): Promise<FileMutationResponse> {
    const response = await filesFetch(`/api/repos/${encodeURIComponent(repo)}/files/move`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return parseMutation(response);
  },
};
