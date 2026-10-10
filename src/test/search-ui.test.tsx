import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SearchPage, { CommandPalette } from '../components/SearchPage';

/** Milestone F UI: search page and ⌘K command palette. */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type FetchMock = ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

describe('SearchPage', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('searches and renders org-scoped results', async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        query: 'login',
        type: 'issues',
        total_count: 1,
        items: [{ type: 'issues', title: 'Login broken', html_url: 'https://github.com/ankworks/website/issues/1', number: 1, state: 'open', repo: 'ankworks/website', is_pull: false }],
      })
    );
    render(
      <MemoryRouter initialEntries={['/search?q=login&type=issues']}>
        <SearchPage />
      </MemoryRouter>
    );
    expect(await screen.findByText('Login broken')).toBeTruthy();
    expect(screen.getByText(/1 result for/)).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toContain('/api/search?q=login&type=issues');
  });

  it('shows an empty state when nothing matches', async () => {
    fetchMock.mockResolvedValueOnce(json({ query: 'zzz', type: 'issues', total_count: 0, items: [] }));
    render(
      <MemoryRouter initialEntries={['/search?q=zzz']}>
        <SearchPage />
      </MemoryRouter>
    );
    expect(await screen.findByText(/No results found/)).toBeTruthy();
  });
});

describe('CommandPalette', () => {
  it('opens with Ctrl-K, filters commands, and navigates on Enter', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <CommandPalette />
      </MemoryRouter>
    );
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(dialog).toBeTruthy();

    const input = screen.getByLabelText('Command palette input');
    fireEvent.change(input, { target: { value: 'Repo' } });
    expect(screen.getByRole('button', { name: 'Repositories' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Issues' })).toBeNull();
    // Search jump is offered for free-text terms.
    expect(screen.getByRole('button', { name: /Search for/ })).toBeTruthy();
  });

  it('closes on Escape', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <CommandPalette />
      </MemoryRouter>
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await screen.findByRole('dialog', { name: 'Command palette' });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull());
  });
});
