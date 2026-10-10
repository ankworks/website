import { motion } from 'framer-motion';
import type { Repository } from '../types';

const formatNumber = (num: number): string => {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);
  
  if (years > 0) {
    return `${years} year${years > 1 ? 's' : ''} ago`;
  }
  if (months > 0) {
    return `${months} month${months > 1 ? 's' : ''} ago`;
  }
  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
  return 'Today';
};

const getLanguageColor = (language: string | null): string => {
  if (!language) return 'bg-gray-600';
  
  const colors: Record<string, string> = {
    TypeScript: 'bg-blue-500',
    JavaScript: 'bg-yellow-500',
    Rust: 'bg-orange-500',
    Python: 'bg-purple-500',
    Go: 'bg-cyan-500',
    Java: 'bg-red-500',
    C: 'bg-blue-400',
    'C++': 'bg-pink-500',
    CSharp: 'bg-green-500',
    PHP: 'bg-indigo-500',
    Swift: 'bg-orange-400',
    Kotlin: 'bg-purple-400',
    Ruby: 'bg-red-400',
    Scala: 'bg-pink-400',
    Elixir: 'bg-purple-600',
    Clojure: 'bg-green-400',
    Haskell: 'bg-purple-700',
    Lua: 'bg-blue-300',
    Perl: 'bg-blue-600',
    Dart: 'bg-cyan-400',
    CoffeeScript: 'bg-brown-500',
    HTML: 'bg-orange-600',
    CSS: 'bg-blue-500',
    Shell: 'bg-green-600',
    PowerShell: 'bg-blue-400',
    ObjectiveC: 'bg-cyan-500',
    MATLAB: 'bg-orange-700',
  };
  
  return colors[language] || 'bg-gray-500';
};

export interface ProjectCardProps {
  repo: Repository;
  index?: number;
}

export default function ProjectCard({ repo, index = 0 }: ProjectCardProps) {
  const languageColor = getLanguageColor(repo.language);

  return (
    <motion.div
      className="glass-card p-6 h-full flex flex-col group"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.05 }}
      whileHover={{ y: -5, boxShadow: '0 10px 30px rgba(163, 230, 53, 0.1)' }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className={`w-3 h-3 rounded-full ${languageColor}`} />
          <h3 className="font-bold text-text group-hover:text-primary transition-colors duration-200 truncate">
            {repo.name}
          </h3>
        </div>
        
        {repo.archived && (
          <span className="text-xs px-2 py-1 bg-surface/50 rounded-full text-text/50">
            Archived
          </span>
        )}
        
        {repo.fork && (
          <span className="text-xs px-2 py-1 bg-surface/50 rounded-full text-text/50">
            Fork
          </span>
        )}
      </div>

      <p className="text-text/60 text-sm mb-6 flex-grow line-clamp-3">
        {repo.description || 'No description provided'}
      </p>

      <div className="flex flex-wrap gap-4 text-sm border-t border-border/30 pt-4">
        <div className="flex items-center space-x-1.5 text-text/70">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9V3"
            />
          </svg>
          <span>{repo.language || 'Unknown'}</span>
        </div>
        
        <div className="flex items-center space-x-1.5 text-text/70">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
            />
          </svg>
          <span>{formatNumber(repo.stargazers_count)}</span>
        </div>
        
        <div className="flex items-center space-x-1.5 text-text/70">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 9l4-4 4 4m0 6l-4 4-4-4"
            />
          </svg>
          <span>{formatNumber(repo.forks_count)}</span>
        </div>
        
        <div className="flex items-center space-x-1.5 text-text/70">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>{formatDate(repo.updated_at)}</span>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-border/30">
        <a
          href={repo.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center space-x-2 text-sm text-primary/80 hover:text-primary transition-colors duration-200"
        >
          <span>View on GitHub</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </div>
    </motion.div>
  );
}
