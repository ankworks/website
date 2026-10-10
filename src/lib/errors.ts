import { RepositoryApiError } from '../api/github';
import { ExplorerApiError } from '../api/explorer';

export interface ErrorDescription {
  title: string;
  message: string;
  /** Whether a retry can plausibly succeed. */
  retryable: boolean;
  retryAfterSeconds?: number;
}

/** Map any API/client error to user-facing copy. Never shows raw upstream text. */
export function describeError(error: unknown): ErrorDescription {
  if (error instanceof ExplorerApiError || error instanceof RepositoryApiError) {
    const code = error.code;
    const retryAfter = error.retryAfterSeconds;
    switch (code) {
      case 'REPO_NOT_FOUND':
        return { title: 'Repository not found', message: 'This repository does not exist or is not public.', retryable: false };
      case 'REF_NOT_FOUND':
        return { title: 'Branch or commit not found', message: 'The requested branch, tag, or commit does not exist in this repository.', retryable: false };
      case 'PATH_NOT_FOUND':
        return { title: 'Path not found', message: 'This directory does not exist at the selected branch or commit.', retryable: false };
      case 'FILE_NOT_FOUND':
        return { title: 'File not found', message: 'This file does not exist at the selected branch or commit.', retryable: false };
      case 'INVALID_REPO':
      case 'INVALID_REF':
      case 'INVALID_PATH':
      case 'MISSING_REF':
        return { title: 'Invalid address', message: 'The address contains characters or segments that are not allowed.', retryable: false };
      case 'GITHUB_RATE_LIMITED':
        return {
          title: 'GitHub rate limit reached',
          message: retryAfter ? `GitHub limits requests for a while. Try again in about ${retryAfter} seconds.` : 'GitHub limits requests for a while. Try again later.',
          retryable: true,
          retryAfterSeconds: retryAfter,
        };
      case 'GITHUB_TIMEOUT':
        return { title: 'GitHub took too long to respond', message: 'The request timed out. Please try again.', retryable: true };
      case 'NETWORK_ERROR':
        return { title: 'Connection problem', message: 'Could not reach the explorer service. Check your connection and try again.', retryable: true };
      case 'REPO_UNAVAILABLE':
        return { title: 'Repository unavailable', message: 'GitHub reports that this repository is unavailable.', retryable: false };
      default:
        return {
          title: 'Something went wrong',
          message: error.message || 'The explorer could not load this content.',
          retryable: error.status >= 500 || error.status === 0,
        };
    }
  }
  return { title: 'Something went wrong', message: 'The explorer could not load this content.', retryable: true };
}
