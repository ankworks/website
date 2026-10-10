import { describe, it, expect } from 'vitest';
import { 
  normalizeRepository, 
  isValidRepository, 
  CACHE_DURATION 
} from '../api/github';
import type { Repository } from '../types';

describe('GitHub API Utilities', () => {
  describe('normalizeRepository', () => {
    it('should normalize a valid GitHub repository', () => {
      const input = {
        id: 123,
        name: 'test-repo',
        full_name: 'ankworks/test-repo',
        description: 'Test description',
        html_url: 'https://github.com/ankworks/test-repo',
        language: 'TypeScript',
        stargazers_count: 10,
        forks_count: 5,
        updated_at: '2024-01-01T00:00:00Z',
        created_at: '2023-01-01T00:00:00Z',
        archived: false,
        fork: false,
        size: 1000,
        open_issues_count: 2,
        topics: ['test', 'example'],
      };

      const result = normalizeRepository(input);

      expect(result.id).toBe(123);
      expect(result.name).toBe('test-repo');
      expect(result.full_name).toBe('ankworks/test-repo');
      expect(result.description).toBe('Test description');
      expect(result.html_url).toBe('https://github.com/ankworks/test-repo');
      expect(result.language).toBe('TypeScript');
      expect(result.stargazers_count).toBe(10);
      expect(result.forks_count).toBe(5);
      expect(result.archived).toBe(false);
      expect(result.fork).toBe(false);
      expect(result.topics).toEqual(['test', 'example']);
    });

    it('should handle null values', () => {
      const input = {
        id: 123,
        name: 'test-repo',
        full_name: 'ankworks/test-repo',
        html_url: 'https://github.com/ankworks/test-repo',
        description: null,
        language: null,
        stargazers_count: 0,
        forks_count: 0,
        updated_at: '',
        created_at: '',
        archived: false,
        fork: false,
        size: 0,
        open_issues_count: 0,
        topics: [],
      };

      const result = normalizeRepository(input);

      expect(result.description).toBeNull();
      expect(result.language).toBeNull();
      expect(result.topics).toEqual([]);
    });

    it('should handle missing properties', () => {
      const input = {
        id: 123,
        name: 'test-repo',
      };

      const result = normalizeRepository(input);

      expect(result.id).toBe(123);
      expect(result.name).toBe('test-repo');
      expect(result.full_name).toBe('');
      expect(result.html_url).toBe('');
    });
  });

  describe('isValidRepository', () => {
    it('should return true for valid repositories', () => {
      const validRepo = {
        id: 123,
        name: 'test-repo',
        full_name: 'ankworks/test-repo',
        html_url: 'https://github.com/ankworks/test-repo',
      };

      expect(isValidRepository(validRepo)).toBe(true);
    });

    it('should return false for null', () => {
      const result = isValidRepository(null);
      expect(result).toBe(false);
    });

    it('should return false for undefined', () => {
      const result = isValidRepository(undefined);
      expect(result).toBe(false);
    });

    it('should return false for non-objects', () => {
      const result1 = isValidRepository('string');
      const result2 = isValidRepository(123);
      const result3 = isValidRepository([]);
      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });

    it('should return false for objects missing required properties', () => {
      const invalidRepo1 = { name: 'test' };
      const invalidRepo2 = { id: 123, name: 'test' };
      const invalidRepo3 = { id: 123, full_name: 'test' };

      const result1 = isValidRepository(invalidRepo1);
      const result2 = isValidRepository(invalidRepo2);
      const result3 = isValidRepository(invalidRepo3);
      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });
  });

  describe('Cache Configuration', () => {
    it('should have cache duration of 5 minutes', () => {
      expect(CACHE_DURATION).toBe(5 * 60 * 1000);
    });
  });
});

describe('Repository Sorting and Filtering', () => {
  const mockRepos: Repository[] = [
    {
      id: 1,
      name: 'repo-a',
      full_name: 'ankworks/repo-a',
      description: 'Description A',
      html_url: 'https://github.com/ankworks/repo-a',
      language: 'TypeScript',
      stargazers_count: 100,
      forks_count: 20,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2023-01-01T00:00:00Z',
      archived: false,
      fork: false,
      size: 1000,
      open_issues_count: 5,
      topics: ['typescript'],
    },
    {
      id: 2,
      name: 'repo-b',
      full_name: 'ankworks/repo-b',
      description: 'Description B',
      html_url: 'https://github.com/ankworks/repo-b',
      language: 'JavaScript',
      stargazers_count: 50,
      forks_count: 10,
      updated_at: '2024-02-01T00:00:00Z',
      created_at: '2023-02-01T00:00:00Z',
      archived: false,
      fork: false,
      size: 500,
      open_issues_count: 2,
      topics: ['javascript'],
    },
    {
      id: 3,
      name: 'repo-c',
      full_name: 'ankworks/repo-c',
      description: 'Description C',
      html_url: 'https://github.com/ankworks/repo-c',
      language: 'TypeScript',
      stargazers_count: 200,
      forks_count: 30,
      updated_at: '2024-03-01T00:00:00Z',
      created_at: '2023-03-01T00:00:00Z',
      archived: true,
      fork: false,
      size: 2000,
      open_issues_count: 10,
      topics: ['typescript', 'archived'],
    },
    {
      id: 4,
      name: 'forked-repo',
      full_name: 'ankworks/forked-repo',
      description: 'Forked repo',
      html_url: 'https://github.com/ankworks/forked-repo',
      language: 'Python',
      stargazers_count: 10,
      forks_count: 1,
      updated_at: '2024-01-15T00:00:00Z',
      created_at: '2023-01-15T00:00:00Z',
      archived: false,
      fork: true,
      size: 200,
      open_issues_count: 0,
      topics: ['python', 'fork'],
    },
  ];

  describe('Sorting', () => {
    it('should sort by stars descending', () => {
      const sorted = [...mockRepos].sort((a, b) => b.stargazers_count - a.stargazers_count);
      expect(sorted[0].id).toBe(3); // repo-c has 200 stars
      expect(sorted[1].id).toBe(1); // repo-a has 100 stars
      expect(sorted[2].id).toBe(2); // repo-b has 50 stars
    });

    it('should sort by stars ascending', () => {
      const sorted = [...mockRepos].sort((a, b) => a.stargazers_count - b.stargazers_count);
      expect(sorted[0].id).toBe(4); // forked-repo has 10 stars
      expect(sorted[1].id).toBe(2); // repo-b has 50 stars
      expect(sorted[2].id).toBe(1); // repo-a has 100 stars
    });

    it('should sort by updated date descending', () => {
      const sorted = [...mockRepos].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      expect(sorted[0].id).toBe(3); // repo-c updated 2024-03-01
      expect(sorted[1].id).toBe(2); // repo-b updated 2024-02-01
      expect(sorted[2].id).toBe(4); // forked-repo updated 2024-01-15
    });

    it('should sort by name ascending', () => {
      const sorted = [...mockRepos].sort((a, b) => a.name.localeCompare(b.name));
      expect(sorted[0].name).toBe('forked-repo');
      expect(sorted[1].name).toBe('repo-a');
      expect(sorted[2].name).toBe('repo-b');
    });

    it('should sort by forks descending', () => {
      const sorted = [...mockRepos].sort((a, b) => b.forks_count - a.forks_count);
      expect(sorted[0].id).toBe(3); // repo-c has 30 forks
      expect(sorted[1].id).toBe(1); // repo-a has 20 forks
      expect(sorted[2].id).toBe(2); // repo-b has 10 forks
    });
  });

  describe('Filtering', () => {
    it('should filter by language', () => {
      const filtered = mockRepos.filter(repo => repo.language === 'TypeScript');
      expect(filtered.length).toBe(2);
      expect(filtered.every(r => r.language === 'TypeScript')).toBe(true);
    });

    it('should filter by search query in name', () => {
      const search = 'repo-a';
      const filtered = mockRepos.filter(
        repo => repo.name.toLowerCase().includes(search.toLowerCase())
      );
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('repo-a');
    });

    it('should filter by search query in description', () => {
      const search = 'Description';
      const filtered = mockRepos.filter(
        repo => repo.description?.toLowerCase().includes(search.toLowerCase()) ?? false
      );
      expect(filtered.length).toBe(3);
    });

    it('should filter out forks', () => {
      const filtered = mockRepos.filter(repo => !repo.fork);
      expect(filtered.length).toBe(3);
      expect(filtered.every(r => !r.fork)).toBe(true);
    });

    it('should filter out archived', () => {
      const filtered = mockRepos.filter(repo => !repo.archived);
      expect(filtered.length).toBe(3);
      expect(filtered.every(r => !r.archived)).toBe(true);
    });

    it('should filter by multiple criteria', () => {
      const filtered = mockRepos.filter(
        repo => !repo.fork && !repo.archived && repo.language === 'TypeScript'
      );
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('repo-a');
    });
  });

  describe('Pagination', () => {
    it('should paginate results', () => {
      const perPage = 2;
      const page1 = mockRepos.slice(0, perPage);
      const page2 = mockRepos.slice(perPage, perPage * 2);

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      expect(page1[0].id).toBe(1);
      expect(page1[1].id).toBe(2);
      expect(page2[0].id).toBe(3);
      expect(page2[1].id).toBe(4);
    });

    it('should calculate total pages', () => {
      const perPage = 2;
      const totalPages = Math.ceil(mockRepos.length / perPage);
      expect(totalPages).toBe(2);
    });
  });
});

describe('Statistics Calculation', () => {
  const mockRepos: Repository[] = [
    {
      id: 1,
      name: 'repo-a',
      full_name: 'ankworks/repo-a',
      description: 'Description A',
      html_url: 'https://github.com/ankworks/repo-a',
      language: 'TypeScript',
      stargazers_count: 100,
      forks_count: 20,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2023-01-01T00:00:00Z',
      archived: false,
      fork: false,
      size: 1000,
      open_issues_count: 5,
      topics: ['typescript'],
    },
    {
      id: 2,
      name: 'repo-b',
      full_name: 'ankworks/repo-b',
      description: 'Description B',
      html_url: 'https://github.com/ankworks/repo-b',
      language: 'JavaScript',
      stargazers_count: 50,
      forks_count: 10,
      updated_at: '2024-02-01T00:00:00Z',
      created_at: '2023-02-01T00:00:00Z',
      archived: false,
      fork: false,
      size: 500,
      open_issues_count: 2,
      topics: ['javascript'],
    },
    {
      id: 3,
      name: 'repo-c',
      full_name: 'ankworks/repo-c',
      description: 'Description C',
      html_url: 'https://github.com/ankworks/repo-c',
      language: 'TypeScript',
      stargazers_count: 200,
      forks_count: 30,
      updated_at: '2024-03-01T00:00:00Z',
      created_at: '2023-03-01T00:00:00Z',
      archived: false,
      fork: false,
      size: 2000,
      open_issues_count: 10,
      topics: ['typescript'],
    },
  ];

  it('should calculate total stars', () => {
    const totalStars = mockRepos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
    expect(totalStars).toBe(350);
  });

  it('should calculate total forks', () => {
    const totalForks = mockRepos.reduce((sum, repo) => sum + repo.forks_count, 0);
    expect(totalForks).toBe(60);
  });

  it('should count languages', () => {
    const languages: Record<string, number> = {};
    mockRepos.forEach(repo => {
      if (repo.language) {
        languages[repo.language] = (languages[repo.language] || 0) + 1;
      }
    });
    expect(languages['TypeScript']).toBe(2);
    expect(languages['JavaScript']).toBe(1);
    expect(Object.keys(languages).length).toBe(2);
  });

  it('should find most starred repository', () => {
    const mostStarred = mockRepos.reduce((prev, current) =>
      (prev.stargazers_count > current.stargazers_count) ? prev : current
    );
    expect(mostStarred.id).toBe(3);
    expect(mostStarred.stargazers_count).toBe(200);
  });

  it('should find recently updated repository', () => {
    const recentlyUpdated = mockRepos.reduce((prev, current) =>
      (new Date(prev.updated_at) > new Date(current.updated_at)) ? prev : current
    );
    expect(recentlyUpdated.id).toBe(3);
  });
});

describe('Empty States', () => {
  it('should handle empty repository list', () => {
    const emptyRepos: Repository[] = [];
    expect(emptyRepos.length).toBe(0);
    expect(emptyRepos.filter(r => !r.fork).length).toBe(0);
  });

  it('should handle repository list with only forks', () => {
    const forkRepos: Repository[] = [
      {
        id: 1,
        name: 'fork-1',
        full_name: 'ankworks/fork-1',
        description: 'Fork 1',
        html_url: 'https://github.com/ankworks/fork-1',
        language: 'JavaScript',
        stargazers_count: 10,
        forks_count: 0,
        updated_at: '2024-01-01T00:00:00Z',
        created_at: '2023-01-01T00:00:00Z',
        archived: false,
        fork: true,
        size: 100,
        open_issues_count: 0,
        topics: [],
      },
    ];
    
    const nonForkRepos = forkRepos.filter(r => !r.fork);
    expect(nonForkRepos.length).toBe(0);
  });

  it('should handle repository list with only archived', () => {
    const archivedRepos: Repository[] = [
      {
        id: 1,
        name: 'archived-1',
        full_name: 'ankworks/archived-1',
        description: 'Archived 1',
        html_url: 'https://github.com/ankworks/archived-1',
        language: 'JavaScript',
        stargazers_count: 10,
        forks_count: 0,
        updated_at: '2024-01-01T00:00:00Z',
        created_at: '2023-01-01T00:00:00Z',
        archived: true,
        fork: false,
        size: 100,
        open_issues_count: 0,
        topics: [],
      },
    ];
    
    const nonArchivedRepos = archivedRepos.filter(r => !r.archived);
    expect(nonArchivedRepos.length).toBe(0);
  });
});
