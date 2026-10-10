import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import MarkdownEditor from '../components/explorer/MarkdownEditor';
import MarkdownFileView from '../components/explorer/MarkdownFileView';
import type { FileResponse } from '../types';

const SHA = 'c'.repeat(40);
const context = { repo: 'website', commitSha: SHA, baseDir: '' };

const MARKDOWN_FILE: FileResponse & { kind: 'text'; content: string } = {
  repo: 'website',
  ref: 'main',
  commit_sha: SHA,
  path: 'docs/guide.md',
  name: 'guide.md',
  kind: 'text',
  size: 64,
  blob_sha: 'd'.repeat(40),
  html_url: 'https://github.com/ankworks/website/blob/main/docs/guide.md',
  content: '# Guide\n\n## Setup\n\nSome **content** here.\n',
};

/** Renders MarkdownFileView at a route and reports the current location. */
function renderFileView(initialUrl = '/repos/website/blob/main/docs/guide.md') {
  function LocationProbe() {
    const location = useLocation();
    return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
  }
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route
          path="/repos/website/blob/main/*"
          element={
            <>
              <MarkdownFileView file={MARKDOWN_FILE} repo="website" path="docs/guide.md" />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

/** Router navigations commit through a transition; wait for the selected tab. */
function expectTabSelected(name: string) {
  return waitFor(() => expect(screen.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true'));
}

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MarkdownFileView tabs', () => {
  it('shows Preview, Source, and Edit tabs with preview active by default', () => {
    renderFileView();
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Source' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByLabelText('Rendered guide.md')).toBeInTheDocument();
  });

  it('renders the table of contents beside the preview for multi-heading documents', () => {
    renderFileView();
    const navigations = screen.getAllByRole('navigation', { name: 'Table of contents' });
    expect(navigations.length).toBeGreaterThan(0);
    expect(within(navigations[0]).getByRole('link', { name: 'Setup' })).toHaveAttribute('href', '#setup');
  });

  it('switches to Source and shows the Markdown with line numbers', async () => {
    const user = userEvent.setup();
    renderFileView();
    await user.click(screen.getByRole('tab', { name: 'Source' }));
    await expectTabSelected('Source');
    // Line-number anchors from the source viewer.
    expect(screen.getByRole('region', { name: 'Source of guide.md' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('href', '#L1');
  });

  it('mirrors the active mode in the ?view= query parameter', async () => {
    const user = userEvent.setup();
    renderFileView();
    expect(screen.getByTestId('location').textContent).toBe('/repos/website/blob/main/docs/guide.md');
    await user.click(screen.getByRole('tab', { name: 'Source' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/repos/website/blob/main/docs/guide.md?view=source')
    );
  });

  it('honors a deep link to a specific mode', () => {
    renderFileView('/repos/website/blob/main/docs/guide.md?view=source');
    expect(screen.getByRole('tab', { name: 'Source' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', { name: 'Source of guide.md' })).toBeInTheDocument();
  });

  it('supports arrow-key navigation between tabs', async () => {
    const user = userEvent.setup();
    renderFileView();
    // Roving tabindex: the selected tab holds focus and the tablist handles keys.
    screen.getByRole('tab', { name: 'Preview' }).focus();
    await user.keyboard('{ArrowRight}');
    await expectTabSelected('Source');
    await user.keyboard('{End}');
    await expectTabSelected('Edit');
    await user.keyboard('{Home}');
    await expectTabSelected('Preview');
  });
});

describe('MarkdownEditor scaffolding', () => {
  function renderEditor(onDirtyChange?: (dirty: boolean) => void) {
    return render(
      <MemoryRouter>
        <MarkdownEditor fileName="guide.md" initialContent={'# Guide\n\nhello\n'} context={context} onDirtyChange={onDirtyChange} />
      </MemoryRouter>
    );
  }

  it('edits a local draft with a live preview and tracks unsaved changes', async () => {
    const onDirtyChange = vi.fn();
    renderEditor(onDirtyChange);

    expect(screen.getByText('No changes')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Markdown source of guide.md'), { target: { value: '# Guide\n\nhello!\n' } });

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText('Live preview pane')).toHaveTextContent('hello!');
  });

  it('keeps committing disabled and explains that sign-in is required', () => {
    renderEditor();
    const commit = screen.getByRole('button', { name: /commit changes/i });
    expect(commit).toBeDisabled();
    expect(commit.getAttribute('title')).toMatch(/sign-in/i);
    expect(screen.getByText(/Local draft/i)).toBeInTheDocument();
  });

  it('warns before unloading the tab while the draft is dirty', () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText('Markdown source of guide.md'), { target: { value: '# Guide\n\nhello!\n' } });

    const event = new Event('beforeunload', { cancelable: true });
    const allowed = window.dispatchEvent(event);
    expect(allowed).toBe(false);
  });

  it('discards the draft after confirmation and drops the dirty state', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderEditor();
    const textarea = screen.getByLabelText('Markdown source of guide.md');
    fireEvent.change(textarea, { target: { value: '# Guide\n\nhello!\n' } });
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(textarea).toHaveValue('# Guide\n\nhello\n');
    expect(screen.getByText('No changes')).toBeInTheDocument();
  });

  it('keeps the draft when discarding is cancelled', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderEditor();
    const textarea = screen.getByLabelText('Markdown source of guide.md');
    fireEvent.change(textarea, { target: { value: '# Guide\n\nhello!\n' } });
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(textarea).toHaveValue('# Guide\n\nhello!\n');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('asks for confirmation before switching away from a dirty draft', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderFileView();
    await user.click(screen.getByRole('tab', { name: 'Edit' }));
    await expectTabSelected('Edit');
    fireEvent.change(screen.getByLabelText('Markdown source of guide.md'), { target: { value: '# Guide\n\nhello!\n' } });

    await user.click(screen.getByRole('tab', { name: 'Preview' }));
    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(screen.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true');

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('tab', { name: 'Preview' }));
    await expectTabSelected('Preview');
  });
});
