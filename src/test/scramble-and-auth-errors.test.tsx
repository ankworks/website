import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AuthErrorBanner from '../components/AuthErrorBanner';
import ScrambleText from '../components/ScrambleText';

/** Sign-in error banner and the scrambled-text heading effect. */

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="search">{location.search}</output>;
}

function renderBanner(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthErrorBanner />
      <LocationProbe />
      <Routes>
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AuthErrorBanner', () => {
  it('renders nothing without an auth_error parameter', () => {
    renderBanner('/');
    expect(screen.queryByTestId('auth-error')).toBeNull();
  });

  it('explains a failed sign-in and strips the parameter', () => {
    renderBanner('/?auth_error=OAUTH_REDIRECT_MISMATCH');
    const banner = screen.getByTestId('auth-error');
    expect(banner.textContent).toContain('OAuth callback URL is not registered');
    expect(banner.textContent).toContain('OAUTH_REDIRECT_MISMATCH');
    // The code is shown once, then removed so a reload does not resurrect it.
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('keeps unrelated query parameters', () => {
    renderBanner('/?tab=issues&auth_error=OAUTH_STATE_MISMATCH');
    expect(screen.getByTestId('search').textContent).toBe('?tab=issues');
    expect(screen.getByTestId('auth-error').textContent).toContain('Sign-in could not be verified');
  });

  it('never shows a raw code without an explanation', () => {
    renderBanner('/?auth_error=SOMETHING_NEW');
    const text = screen.getByTestId('auth-error').textContent ?? '';
    expect(text).toContain('Sign-in failed');
    // The raw code is still shown, for reporting, alongside the explanation.
    expect(text).toContain('SOMETHING_NEW');
  });
});

describe('ScrambleText', () => {
  function stubReducedMotion(reduced: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: reduced && query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  }

  it('exposes the real text to assistive tech from the start', () => {
    stubReducedMotion(false);
    const { container } = render(<ScrambleText text="AnkWorks" />);
    expect(container.querySelector('.sr-only')?.textContent).toBe('AnkWorks');
    expect(container.querySelector('[data-scramble-output]')?.textContent).toBe('AnkWorks');
  });

  it('scrambles on hover and settles back to the real text', () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { container } = render(<ScrambleText text="Forge" />);
    const root = container.querySelector('[data-scramble-text]') as HTMLElement;
    const output = () => container.querySelector('[data-scramble-output]')?.textContent ?? '';

    act(() => {
      fireEvent.pointerEnter(root);
      vi.advanceTimersByTime(34);
    });
    // Mid-flight the output is glyphs, but never longer than the label.
    const mid = output();
    expect(mid.length).toBe('Forge'.length);
    expect(mid).not.toBe('Forge');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(output()).toBe('Forge');
    vi.useRealTimers();
  });

  it('settles in under half a second', () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const { container } = render(<ScrambleText text="Pull Requests" />);
    const root = container.querySelector('[data-scramble-text]') as HTMLElement;
    const output = () => container.querySelector('[data-scramble-output]')?.textContent ?? '';

    act(() => {
      fireEvent.pointerEnter(root);
      vi.advanceTimersByTime(250);
    });
    expect(output()).toBe('Pull Requests');
    vi.useRealTimers();
  });

  it('does not animate when reduced motion is requested', () => {
    vi.useFakeTimers();
    stubReducedMotion(true);
    const { container } = render(<ScrambleText text="Issues" />);
    const root = container.querySelector('[data-scramble-text]') as HTMLElement;
    act(() => {
      fireEvent.pointerEnter(root);
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelector('[data-scramble-output]')?.textContent).toBe('Issues');
    vi.useRealTimers();
  });
});
