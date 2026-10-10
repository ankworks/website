import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DiffView from '../components/explorer/DiffView';
import type { CompareResponse } from '../types';

/** Milestone C diff viewer: unified patches rendered with add/del rows. */

function compare(overrides: Partial<CompareResponse> = {}): CompareResponse {
  return {
    repo: 'website',
    base: 'main',
    head: 'feature/x',
    status: 'ahead',
    ahead_by: 2,
    behind_by: 0,
    total_commits: 2,
    html_url: 'https://github.com/ankworks/website/compare/main...feature/x',
    files: [
      {
        filename: 'docs/guide.md',
        status: 'modified',
        additions: 2,
        deletions: 1,
        patch: '@@ -1,2 +1,3 @@\n- old line\n+ new line\n+ another line\n context line\n',
      },
    ],
    fetched_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DiffView', () => {
  it('renders the range summary and per-file patches', () => {
    render(<DiffView compare={compare()} />);
    expect(screen.getByTestId('diff-view')).toBeInTheDocument();
    expect(screen.getByText('docs/guide.md')).toBeInTheDocument();
    expect(screen.getByText('@@ -1,2 +1,3 @@')).toBeInTheDocument();
    expect(screen.getByText('+ new line')).toBeInTheDocument();
    expect(screen.getByText('- old line')).toBeInTheDocument();
    expect(screen.getByText('context line')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View comparison on GitHub/ })).toBeInTheDocument();
    expect(screen.getByText(/2 commits/)).toBeInTheDocument();
  });

  it('explains missing patches (binary or oversized files)', () => {
    render(
      <DiffView
        compare={compare({
          files: [{ filename: 'logo.png', status: 'added', additions: 0, deletions: 0, patch: null }],
        })}
      />
    );
    expect(screen.getByText(/No textual diff is available/)).toBeInTheDocument();
  });

  it('shows an empty state when the range has no file changes', () => {
    render(<DiffView compare={compare({ files: [], total_commits: 0 })} />);
    expect(screen.getByText(/No file changes/)).toBeInTheDocument();
    expect(screen.getByText(/0 commits/)).toBeInTheDocument();
  });
});
