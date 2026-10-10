import { describe, it, expect } from 'vitest';
import { sanitizeRepository } from '../shared/repository';

const base = {
  id: 42,
  name: 'website',
  full_name: 'ankworks/website',
  private: false,
  html_url: 'https://github.com/ankworks/website',
  description: 'Site',
  language: 'TypeScript',
  stargazers_count: 3,
  forks_count: 1,
  updated_at: '2026-01-01T00:00:00Z',
  created_at: '2025-01-01T00:00:00Z',
  archived: false,
  fork: false,
  size: 10,
  open_issues_count: 0,
  topics: ['react'],
};

describe('sanitizeRepository', () => {
  it('accepts a valid public repository', () => {
    expect(sanitizeRepository(base)).toMatchObject({ id: 42, name: 'website', language: 'TypeScript' });
  });

  it('rejects private repositories', () => {
    expect(sanitizeRepository({ ...base, private: true })).toBeNull();
  });

  it('rejects links that do not point to github.com over https', () => {
    expect(sanitizeRepository({ ...base, html_url: 'javascript:alert(1)' })).toBeNull();
    expect(sanitizeRepository({ ...base, html_url: 'https://evil.example/ankworks/website' })).toBeNull();
  });

  it('rejects payloads without an id, name or full_name', () => {
    expect(sanitizeRepository({ ...base, id: 'abc' })).toBeNull();
    expect(sanitizeRepository({ ...base, name: '' })).toBeNull();
    expect(sanitizeRepository({ ...base, full_name: undefined })).toBeNull();
    expect(sanitizeRepository(null)).toBeNull();
    expect(sanitizeRepository(['x'])).toBeNull();
  });

  it('coerces invalid numeric and date fields to safe defaults', () => {
    const repo = sanitizeRepository({
      ...base,
      stargazers_count: -5,
      forks_count: 'many',
      updated_at: 'not-a-date',
    });
    expect(repo?.stargazers_count).toBe(0);
    expect(repo?.forks_count).toBe(0);
    expect(repo?.updated_at).toBe('');
  });

  it('truncates long descriptions and limits topics', () => {
    const repo = sanitizeRepository({
      ...base,
      description: 'x'.repeat(2000),
      topics: Array.from({ length: 50 }, (_, i) => `t${i}`),
    });
    expect(repo?.description?.length).toBe(500);
    expect(repo?.topics).toHaveLength(20);
  });

  it('does not copy unrelated upstream fields', () => {
    const repo = sanitizeRepository({ ...base, token: 'secret', owner: { login: 'x' } });
    expect(repo).not.toHaveProperty('token');
    expect(repo).not.toHaveProperty('owner');
  });
});
