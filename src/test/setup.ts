import '@testing-library/jest-dom';
import { afterEach, beforeAll, afterAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Clean up after each test
afterEach(() => {
  cleanup();
});

// Global test setup
beforeAll(() => {
  // Mock fetch for GitHub API calls
  globalThis.fetch = vi.fn();
});

afterAll(() => {
  vi.restoreAllMocks();
});
