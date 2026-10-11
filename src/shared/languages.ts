/**
 * Language detection from file names. The `grammar` value is a highlight.js
 * language id registered in `src/lib/highlighter.ts`; `null` means plain text.
 */
export interface LanguageInfo {
  label: string;
  grammar: string | null;
}

const PLAIN: LanguageInfo = { label: 'Plain Text', grammar: null };

const BY_EXTENSION: Record<string, LanguageInfo> = {
  ts: { label: 'TypeScript', grammar: 'typescript' },
  tsx: { label: 'TypeScript (JSX)', grammar: 'typescript' },
  mts: { label: 'TypeScript', grammar: 'typescript' },
  cts: { label: 'TypeScript', grammar: 'typescript' },
  js: { label: 'JavaScript', grammar: 'javascript' },
  jsx: { label: 'JavaScript (JSX)', grammar: 'javascript' },
  mjs: { label: 'JavaScript', grammar: 'javascript' },
  cjs: { label: 'JavaScript', grammar: 'javascript' },
  json: { label: 'JSON', grammar: 'json' },
  css: { label: 'CSS', grammar: 'css' },
  scss: { label: 'SCSS', grammar: 'scss' },
  html: { label: 'HTML', grammar: 'xml' },
  htm: { label: 'HTML', grammar: 'xml' },
  xml: { label: 'XML', grammar: 'xml' },
  svg: { label: 'SVG', grammar: 'xml' },
  md: { label: 'Markdown', grammar: 'markdown' },
  markdown: { label: 'Markdown', grammar: 'markdown' },
  sh: { label: 'Shell', grammar: 'bash' },
  bash: { label: 'Shell', grammar: 'bash' },
  zsh: { label: 'Shell', grammar: 'bash' },
  py: { label: 'Python', grammar: 'python' },
  go: { label: 'Go', grammar: 'go' },
  rs: { label: 'Rust', grammar: 'rust' },
  java: { label: 'Java', grammar: 'java' },
  kt: { label: 'Kotlin', grammar: 'kotlin' },
  swift: { label: 'Swift', grammar: 'swift' },
  rb: { label: 'Ruby', grammar: 'ruby' },
  php: { label: 'PHP', grammar: 'php' },
  c: { label: 'C', grammar: 'c' },
  h: { label: 'C', grammar: 'c' },
  cc: { label: 'C++', grammar: 'cpp' },
  cpp: { label: 'C++', grammar: 'cpp' },
  hpp: { label: 'C++', grammar: 'cpp' },
  cs: { label: 'C#', grammar: 'csharp' },
  sql: { label: 'SQL', grammar: 'sql' },
  yml: { label: 'YAML', grammar: 'yaml' },
  yaml: { label: 'YAML', grammar: 'yaml' },
  toml: { label: 'TOML', grammar: 'ini' },
  ini: { label: 'INI', grammar: 'ini' },
  diff: { label: 'Diff', grammar: 'diff' },
  patch: { label: 'Diff', grammar: 'diff' },
};

const BY_FILE_NAME: Record<string, LanguageInfo> = {
  dockerfile: { label: 'Dockerfile', grammar: 'dockerfile' },
  makefile: { label: 'Makefile', grammar: 'makefile' },
};

/** Markdown fence tags (```ts, ```sh, …) mapped to highlight.js grammars. */
const FENCE_ALIASES: Record<string, string> = {
  js: 'javascript',
  javascript: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'typescript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'xml',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'bash',
  bash: 'bash',
  shell: 'bash',
  zsh: 'bash',
  py: 'python',
  python: 'python',
  go: 'go',
  rust: 'rust',
  rs: 'rust',
  java: 'java',
  kotlin: 'kotlin',
  swift: 'swift',
  ruby: 'ruby',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  cpp: 'cpp',
  'c++': 'cpp',
  csharp: 'csharp',
  cs: 'csharp',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  diff: 'diff',
  patch: 'diff',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
};

/** Detect the language of a repository file from its name. */
export function detectLanguage(path: string): LanguageInfo {
  const name = (path.split('/').pop() ?? '').toLowerCase();
  if (name === '') return PLAIN;
  const byName = BY_FILE_NAME[name];
  if (byName) return byName;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return PLAIN;
  return BY_EXTENSION[name.slice(dot + 1)] ?? PLAIN;
}

/** Display label for a code fence tag ("ts" → "TypeScript", "sh" → "Shell"). */
const FENCE_LABELS: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TypeScript',
  json: 'JSON',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  xml: 'XML',
  svg: 'SVG',
  md: 'Markdown',
  markdown: 'Markdown',
  sh: 'Shell',
  bash: 'Shell',
  shell: 'Shell',
  zsh: 'Shell',
  py: 'Python',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  rs: 'Rust',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  ruby: 'Ruby',
  rb: 'Ruby',
  php: 'PHP',
  c: 'C',
  cpp: 'C++',
  'c++': 'C++',
  csharp: 'C#',
  cs: 'C#',
  sql: 'SQL',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  ini: 'INI',
  diff: 'Diff',
  patch: 'Diff',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  mermaid: 'Mermaid',
  text: 'Text',
  plaintext: 'Text',
};

/** Human-readable label for a fence tag. Falls back to the tag itself. */
export function languageLabel(tag: string | undefined): string | null {
  if (!tag) return null;
  const key = tag.toLowerCase();
  return FENCE_LABELS[key] ?? (FENCE_ALIASES[key] ? key : null);
}

/** Map a markdown code-fence language tag to a registered grammar, or null. */
export function grammarForFenceTag(tag: string | undefined): string | null {
  if (!tag) return null;
  return FENCE_ALIASES[tag.toLowerCase()] ?? null;
}
