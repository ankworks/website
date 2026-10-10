import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Navigation from '../components/Navigation';
import Footer from '../components/Footer';
import Hero from '../components/Hero';
import ProjectCard from '../components/ProjectCard';
import type { Repository } from '../types';

describe('Component Rendering', () => {
  describe('Navigation', () => {
    beforeEach(() => {
      render(
        <MemoryRouter>
          <Navigation />
        </MemoryRouter>
      );
    });

    it('should render the logo', () => {
      const logo = screen.getByText('AnkWorks');
      expect(logo).toBeInTheDocument();
    });

    it('should render navigation links', () => {
      const homeLink = screen.getByText('Home');
      const projectsLink = screen.getByText('Projects');
      const aboutLink = screen.getByText('About');
      const githubLink = screen.getByText('GitHub');

      expect(homeLink).toBeInTheDocument();
      expect(projectsLink).toBeInTheDocument();
      expect(aboutLink).toBeInTheDocument();
      expect(githubLink).toBeInTheDocument();
    });

    it('should have GitHub link with external attributes', () => {
      const githubLink = screen.getByText('GitHub');
      expect(githubLink).toHaveAttribute('href', 'https://github.com/ankworks');
      expect(githubLink).toHaveAttribute('target', '_blank');
      expect(githubLink).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  describe('Footer', () => {
    beforeEach(() => {
      render(
        <MemoryRouter>
          <Footer />
        </MemoryRouter>
      );
    });

    it('should render the logo', () => {
      const logo = screen.getByText('AnkWorks');
      expect(logo).toBeInTheDocument();
    });

    it('should render copyright', () => {
      const currentYear = new Date().getFullYear();
      const copyright = screen.getByText(new RegExp(`© ${currentYear} AnkWorks`));
      expect(copyright).toBeInTheDocument();
    });

    it('should render navigation links', () => {
      const homeLink = screen.getByText('Home');
      const projectsLink = screen.getByText('Projects');
      const aboutLink = screen.getByText('About');

      expect(homeLink).toBeInTheDocument();
      expect(projectsLink).toBeInTheDocument();
      expect(aboutLink).toBeInTheDocument();
    });

    it('should render external links', () => {
      const githubLink = screen.getByText('GitHub');
      const contactLink = screen.getByText('Contact');

      expect(githubLink).toBeInTheDocument();
      expect(contactLink).toBeInTheDocument();
    });
  });

  describe('Hero', () => {
    beforeEach(() => {
      render(
        <MemoryRouter>
          <Hero />
        </MemoryRouter>
      );
    });

    it('should render main heading', () => {
      const heading = screen.getByText(/Building things that matter/i);
      expect(heading).toBeInTheDocument();
    });

    it('should render subtitle', () => {
      const subtitle = screen.getByText(/Independent software projects/i);
      expect(subtitle).toBeInTheDocument();
    });

    it('should render Explore Projects button', () => {
      const button = screen.getByText('Explore Projects');
      expect(button).toBeInTheDocument();
    });

    it('should render GitHub Organization button', () => {
      const button = screen.getByText('GitHub Organization');
      expect(button).toBeInTheDocument();
    });
  });

  describe('ProjectCard', () => {
    const mockRepo: Repository = {
      id: 1,
      name: 'test-repo',
      full_name: 'ankworks/test-repo',
      description: 'Test description',
      html_url: 'https://github.com/ankworks/test-repo',
      language: 'TypeScript',
      stargazers_count: 100,
      forks_count: 20,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2023-01-01T00:00:00Z',
      archived: false,
      fork: false,
      size: 1000,
      open_issues_count: 5,
      topics: ['test'],
    };

    beforeEach(() => {
      render(
        <MemoryRouter>
          <ProjectCard repo={mockRepo} index={0} />
        </MemoryRouter>
      );
    });

    it('should render repository name', () => {
      const name = screen.getByText('test-repo');
      expect(name).toBeInTheDocument();
    });

    it('should render repository description', () => {
      const description = screen.getByText('Test description');
      expect(description).toBeInTheDocument();
    });

    it('should render language', () => {
      const language = screen.getByText('TypeScript');
      expect(language).toBeInTheDocument();
    });

    it('should render star count', () => {
      const stars = screen.getByText('100');
      expect(stars).toBeInTheDocument();
    });

    it('should render fork count', () => {
      const forks = screen.getByText('20');
      expect(forks).toBeInTheDocument();
    });

    it('should render View on GitHub link', () => {
      const link = screen.getByText('View on GitHub');
      expect(link).toBeInTheDocument();
      const anchor = link.closest('a');
      expect(anchor).toHaveAttribute('href', 'https://github.com/ankworks/test-repo');
      expect(anchor).toHaveAttribute('target', '_blank');
      expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should show archived badge for archived repositories', () => {
      const archivedRepo: Repository = {
        ...mockRepo,
        archived: true,
      };
      
      render(
        <MemoryRouter>
          <ProjectCard repo={archivedRepo} index={0} />
        </MemoryRouter>
      );

      const archivedBadge = screen.getByText('Archived');
      expect(archivedBadge).toBeInTheDocument();
    });

    it('should show fork badge for forked repositories', () => {
      const forkedRepo: Repository = {
        ...mockRepo,
        fork: true,
      };
      
      render(
        <MemoryRouter>
          <ProjectCard repo={forkedRepo} index={0} />
        </MemoryRouter>
      );

      const forkBadge = screen.getByText('Fork');
      expect(forkBadge).toBeInTheDocument();
    });

    it('should show null description placeholder', () => {
      const noDescRepo: Repository = {
        ...mockRepo,
        description: null,
      };
      
      render(
        <MemoryRouter>
          <ProjectCard repo={noDescRepo} index={0} />
        </MemoryRouter>
      );

      const placeholder = screen.getByText('No description provided');
      expect(placeholder).toBeInTheDocument();
    });
  });
});

describe('Accessibility', () => {
  describe('Navigation', () => {
    it('should have proper aria labels for mobile menu button', () => {
      render(
        <MemoryRouter>
          <Navigation />
        </MemoryRouter>
      );

      const menuButton = screen.getByLabelText('Toggle menu');
      expect(menuButton).toBeInTheDocument();
    });
  });

  describe('ProjectCard', () => {
    const mockRepo: Repository = {
      id: 1,
      name: 'test-repo',
      full_name: 'ankworks/test-repo',
      description: 'Test description',
      html_url: 'https://github.com/ankworks/test-repo',
      language: 'TypeScript',
      stargazers_count: 100,
      forks_count: 20,
      updated_at: '2024-01-01T00:00:00Z',
      created_at: '2023-01-01T00:00:00Z',
      archived: false,
      fork: false,
      size: 1000,
      open_issues_count: 5,
      topics: ['test'],
    };

    it('should have external link attributes', () => {
      render(
        <MemoryRouter>
          <ProjectCard repo={mockRepo} index={0} />
        </MemoryRouter>
      );

      const link = screen.getByText('View on GitHub');
      const anchor = link.closest('a');
      expect(anchor).toHaveAttribute('target', '_blank');
      expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });
});
