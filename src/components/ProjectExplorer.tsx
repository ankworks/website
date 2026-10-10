import { useRepos } from '../hooks';
import ProjectCard from './ProjectCard';
import { motion } from 'framer-motion';

export default function ProjectExplorer() {
  const {
    repos,
    loading,
    error,
    filters,
    updateFilter,
    updateSort,
    page,
    hasMore,
    totalCount,
    languages,
    nextPage,
    prevPage,
    refresh,
    totalPages,
  } = useRepos();

  if (loading && repos.length === 0) {
    return (
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Skeleton loading for filters */}
          <div className="flex flex-col md:flex-row gap-4 mb-8">
            <div className="h-12 bg-surface/50 rounded-lg w-full md:w-64 animate-pulse" />
            <div className="h-12 bg-surface/50 rounded-lg w-full md:w-48 animate-pulse" />
            <div className="h-12 bg-surface/50 rounded-lg w-full md:w-48 animate-pulse" />
          </div>
          
          {/* Skeleton loading for grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="glass-card p-6 h-64 animate-pulse">
                <div className="h-4 bg-surface/50 rounded mb-3 w-3/4" />
                <div className="h-3 bg-surface/30 rounded mb-2 w-full" />
                <div className="h-3 bg-surface/30 rounded mb-4 w-2/3" />
                <div className="flex space-x-4 mt-auto pt-4 border-t border-border/30">
                  <div className="h-8 bg-surface/50 rounded w-16" />
                  <div className="h-8 bg-surface/50 rounded w-16" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto text-center">
          <div className="text-red-500 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 className="text-2xl font-bold text-text mb-2">Error loading projects</h3>
          <p className="text-text/60 mb-6">{error}</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={refresh}
              className="btn-secondary"
            >
              Retry
            </button>
            <a
              href="https://github.com/ankworks"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex items-center justify-center space-x-2"
            >
              <span>View on GitHub</span>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path
                  fillRule="evenodd"
                  d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.168 6.839 9.49.5.092.682-.217.682-.482 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.031-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.203 2.398.1 2.651.64.7 1.03 1.595 1.03 2.688 0 3.848-2.338 4.695-4.566 4.942.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.001 10.001 0 0022 12c0-5.523-4.477-10-10-10z"
                  clipRule="evenodd"
                />
              </svg>
            </a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h2 className="text-3xl font-bold text-text mb-2">Projects</h2>
              <p className="text-text/60">
                Explore {totalCount} public repository{totalCount !== 1 ? 'ies' : ''} from AnkWorks
              </p>
            </div>
            
            <div className="flex items-center space-x-4">
              <button
                onClick={refresh}
                className="flex items-center space-x-2 px-4 py-2 bg-surface/50 rounded-lg border border-border/30 hover:bg-surface/80 transition-colors duration-200 text-sm"
                disabled={loading}
              >
                <svg className="w-4 h-4 text-text/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span>Refresh</span>
              </button>
            </div>
          </div>
        </motion.div>

        {/* Filters and Search */}
        <motion.div
          className="glass-card p-6 mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search */}
            <div className="lg:col-span-2">
              <label htmlFor="search" className="sr-only">Search repositories</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-text/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  id="search"
                  placeholder="Search repositories..."
                  value={filters.search}
                  onChange={(e) => updateFilter({ search: e.target.value })}
                  className="input-field w-full pl-10"
                />
              </div>
            </div>

            {/* Language Filter */}
            <div>
              <label htmlFor="language" className="sr-only">Filter by language</label>
              <select
                id="language"
                value={filters.language}
                onChange={(e) => updateFilter({ language: e.target.value })}
                className="input-field w-full appearance-none bg-transparent"
              >
                <option value="">All Languages</option>
                {languages.map((lang) => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>

            {/* Sort */}
            <div>
              <label htmlFor="sort" className="sr-only">Sort by</label>
              <select
                id="sort"
                value={filters.sort_by}
                onChange={(e) => updateSort(e.target.value as any)}
                className="input-field w-full appearance-none bg-transparent"
              >
                <option value="stars">Stars</option>
                <option value="updated">Recently Updated</option>
                <option value="name">Name</option>
                <option value="forks">Forks</option>
              </select>
            </div>
          </div>

          <div className="mt-4 flex items-center space-x-4">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.include_forks}
                onChange={(e) => updateFilter({ include_forks: e.target.checked })}
                className="w-4 h-4 rounded border-border/50 text-primary focus:ring-primary/50"
              />
              <span className="text-sm text-text/60">Include forks</span>
            </label>
            
            <div className="ml-auto text-sm text-text/50">
              Showing {repos.length} of {totalCount} repositories
            </div>
          </div>
        </motion.div>

        {/* Results */}
        {repos.length === 0 ? (
          <motion.div
            className="text-center py-16"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="text-text/50 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-text mb-2">No repositories found</h3>
            <p className="text-text/60">Try adjusting your filters or search query</p>
          </motion.div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
              {repos.map((repo, index) => (
                <ProjectCard key={repo.id} repo={repo} index={index} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <motion.div
                className="flex items-center justify-center space-x-4"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
              >
                <button
                  onClick={prevPage}
                  disabled={page === 1}
                  className="p-2 rounded-lg bg-surface/50 hover:bg-surface/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                >
                  <svg className="w-5 h-5 text-text/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>
                
                <span className="text-sm text-text/60">
                  Page {page} of {totalPages}
                </span>
                
                <button
                  onClick={nextPage}
                  disabled={!hasMore}
                  className="p-2 rounded-lg bg-surface/50 hover:bg-surface/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                >
                  <svg className="w-5 h-5 text-text/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </motion.div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
