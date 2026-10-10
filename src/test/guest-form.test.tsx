import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GuestIssueForm } from '../components/collaboration/GuestIssueForm';

/** Milestone E UI: guest submission form with Turnstile + disabled fallback. */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type FetchMock = ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>>;

describe('GuestIssueForm', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('explains when guest submissions are disabled', async () => {
    fetchMock.mockResolvedValueOnce(json({ enabled: false, siteKey: null }));
    render(<GuestIssueForm />);
    await screen.findByText(/Guest submissions are disabled/);
    expect(screen.queryByRole('button', { name: /Submit for review/ })).toBeNull();
  });

  it('renders the form and Turnstile slot when enabled', async () => {
    fetchMock.mockResolvedValueOnce(json({ enabled: true, siteKey: 'site-key' }));
    render(<GuestIssueForm />);
    expect(await screen.findByTestId('turnstile-widget')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Submit for review/ })).toBeDisabled();
  });

  it('submits a verified request and shows the review notice', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/guest/config')) return json({ enabled: true, siteKey: null });
      return json({ id: 1, status: 'pending' });
    });
    render(<GuestIssueForm />);
    await screen.findByRole('button', { name: /Submit for review/ });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email (private)'), { target: { value: 'ada@example.test' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Broken' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Details' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit for review/ }));

    await waitFor(() => expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/api/guest/issues'))).toBe(true));
    await screen.findByText(/queued for review/);
    const submitCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/guest/issues'));
    const payload = JSON.parse(String((submitCall?.[1] as RequestInit).body)) as Record<string, string>;
    expect(payload.email).toBe('ada@example.test');
    expect(payload.turnstileToken).toBe('');
    expect(payload.website).toBe('');
  });

  it('surfaces submission failures', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/guest/config')) return json({ enabled: true, siteKey: null });
      return json({ error: 'CAPTCHA_FAILED', message: 'Turnstile verification failed.', status: 403 }, 403);
    });
    render(<GuestIssueForm />);
    await screen.findByRole('button', { name: /Submit for review/ });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email (private)'), { target: { value: 'ada@example.test' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Broken' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Details' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit for review/ }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toMatch(/Turnstile/);
  });
});
