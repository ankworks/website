/**
 * Issue templates from `.github/ISSUE_TEMPLATE/` (V3-C).
 *
 * Read-only. Templates are rendered as static Markdown and pre-filled into the
 * issue composer; GitHub issue forms (YAML) are converted to a readable
 * checklist rather than being executed — Forge has no form runtime and will not
 * invent one.
 *
 * Layout handled:
 *   .github/ISSUE_TEMPLATE/*.md            classic templates (YAML front matter)
 *   .github/ISSUE_TEMPLATE/*.yml|.yaml     issue forms (rendered statically)
 *   .github/ISSUE_TEMPLATE.md              single legacy template
 *   ISSUE_TEMPLATE.md                      legacy root template
 *
 * Limits: at most 20 templates, 64 KiB each, 1 KiB–safe strings only. Content
 * is never interpreted as HTML — the front end sanitizes it like any other
 * repository Markdown.
 */

import { ORG_NAME } from '../shared/validation';
import type { IssueTemplate } from '../shared/issue-templates';
import { buildGitHubUrl, githubGet, readJson } from './github-client';
import type { Env } from './env';
import { logEvent } from './logging';

const MAX_TEMPLATES = 20;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_NAME = 120;
const MAX_ABOUT = 400;
const MAX_BODY = 32 * 1024;
const TEMPLATE_DIR = '.github/ISSUE_TEMPLATE';

interface TreeEntry {
  path?: string;
  type?: string;
  size?: number;
}

interface ContentsPayload {
  content?: string;
  encoding?: string;
}

/** Decode a GitHub contents payload (base64, possibly line-wrapped). */
function decodeContent(payload: ContentsPayload): string | null {
  if (typeof payload.content !== 'string') return null;
  if ((payload.encoding ?? 'base64') !== 'base64') return null;
  const normalized = payload.content.replace(/\s+/g, '');
  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Split a document into its leading `---` front matter and the rest. */
function splitFrontMatter(text: string): { front: string | null; body: string } {
  const lines = text.split('\n');
  if (lines.length === 0 || lines[0]?.trim() !== '---') return { front: null, body: text };
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      return { front: lines.slice(1, i).join('\n'), body: lines.slice(i + 1).join('\n') };
    }
  }
  return { front: null, body: text };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Minimal, tolerant reader for the flat `key: value` front matter GitHub uses
 * in templates. It is intentionally not a YAML implementation: unknown or
 * nested constructs are ignored rather than mis-parsed.
 */
function parseFrontMatter(front: string | null): {
  name: string | null;
  about: string | null;
  title: string | null;
  labels: string[];
  assignees: string[];
} {
  const result = { name: null as string | null, about: null as string | null, title: null as string | null, labels: [] as string[], assignees: [] as string[] };
  if (!front) return result;
  let key: string | null = null;
  for (const rawLine of front.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key === 'labels') {
      const value = unquote(item[1] ?? '');
      if (value) result.labels.push(value.slice(0, 60));
      continue;
    }
    if (item && key === 'assignees') {
      const value = unquote(item[1] ?? '').replace(/^@/, '');
      if (value) result.assignees.push(value.slice(0, 60));
      continue;
    }
    const pair = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    key = (pair[1] ?? '').toLowerCase();
    const value = unquote(pair[2] ?? '').slice(0, MAX_ABOUT);
    if (key === 'name') result.name = value.slice(0, MAX_NAME);
    else if (key === 'about' || key === 'description') result.about = value.slice(0, MAX_ABOUT);
    else if (key === 'title') result.title = value.slice(0, MAX_NAME);
    else if (key === 'labels' && value) {
      // `labels: bug, triage` is a comma-separated list in GitHub templates.
      for (const entry of value.split(',')) {
        const label = entry.trim();
        if (label) result.labels.push(label.slice(0, 60));
      }
    } else if (key === 'assignees' && value) {
      for (const entry of value.split(',')) {
        const login = entry.trim().replace(/^@/, '');
        if (login) result.assignees.push(login.slice(0, 60));
      }
    }
  }
  return result;
}

/** Render a GitHub issue form (`body:` list) as static Markdown. */
function renderForm(front: string): { body: string; parsed: boolean } {
  const lines = front.split('\n');
  const out: string[] = [];
  let inBody = false;
  let blockType = '';
  let block: Record<string, string> = {};
  let sawField = false;
  let listKey: string | null = null;
  const listItems: string[] = [];

  const flushList = () => {
    if (listKey === 'options' && listItems.length > 0) {
      if (blockType === 'checkboxes') {
        for (const item of listItems) out.push(`- [ ] ${item}`);
      } else {
        out.push(`_Choose one:_ ${listItems.join(', ')}`);
      }
    }
    listKey = null;
    listItems.length = 0;
  };

  const flush = () => {
    flushList();
    const label = block.label ?? '';
    const description = block.description ?? '';
    const placeholder = block.placeholder ?? '';
    switch (blockType) {
      case 'markdown':
        if (block.value) out.push(block.value);
        break;
      case 'textarea':
      case 'input':
        if (label) out.push(`**${label}**${block.required === 'true' ? ' _(required)_' : ''}`);
        if (description) out.push(description);
        if (placeholder) out.push(`> ${placeholder}`);
        if (blockType === 'textarea' && block.value) out.push(block.value);
        out.push('');
        break;
      case 'dropdown':
        if (label) out.push(`**${label}**`);
        if (description) out.push(description);
        break;
      case 'checkboxes':
        if (label) out.push(`**${label}**`);
        if (description) out.push(description);
        break;
      default:
        break;
    }
    blockType = '';
    block = {};
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (/^[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(line)) {
      if (inBody && blockType) flush();
      inBody = false;
      const key = (/^([A-Za-z_][A-Za-z0-9_-]*)\s*:/.exec(line)?.[1] ?? '').toLowerCase();
      if (key === 'body') inBody = true;
      continue;
    }
    if (!inBody) continue;

    const blockStart = /^\s*-\s+type\s*:\s*(\S+)\s*$/.exec(line);
    if (blockStart) {
      if (blockType) flush();
      blockType = (blockStart[1] ?? '').toLowerCase();
      sawField = true;
      continue;
    }
    const listItem = /^\s+-\s+(.*)$/.exec(line);
    if (listItem) {
      let value = unquote(listItem[1] ?? '');
      // Checkbox options are `- label: text`, not bare strings.
      const labelled = /^label\s*:\s*(.*)$/.exec(value);
      if (labelled) value = unquote(labelled[1] ?? '');
      if (value) listItems.push(value.slice(0, 200));
      continue;
    }
    const listStart = /^\s+([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*$/.exec(line);
    if (listStart) {
      flushList();
      listKey = (listStart[1] ?? '').toLowerCase();
      continue;
    }
    const attr = /^\s+([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (attr && blockType) {
      block[(attr[1] ?? '').toLowerCase()] = unquote(attr[2] ?? '').slice(0, 500);
      continue;
    }
  }
  if (inBody && blockType) flush();

  return { body: out.join('\n').trim(), parsed: sawField };
}

export function buildTemplate(fileName: string, text: string): IssueTemplate {
  const { front, body } = splitFrontMatter(text);
  const meta = parseFrontMatter(front);
  const isForm = /\.(yml|yaml)$/i.test(fileName);
  const fallbackName = fileName.replace(/\.(md|yml|yaml)$/i, '').replace(/[-_]+/g, ' ').trim();

  if (!isForm) {
    return {
      fileName,
      name: meta.name ?? (fallbackName || fileName),
      about: meta.about,
      title: meta.title,
      labels: meta.labels,
      assignees: meta.assignees,
      body: body.trim().slice(0, MAX_BODY),
      format: 'markdown',
      parsed: true,
    };
  }

  const rendered = renderForm(front ?? '');
  return {
    fileName,
    name: meta.name ?? (fallbackName || fileName),
    about: meta.about ?? null,
    title: meta.title,
    labels: meta.labels,
    assignees: meta.assignees,
    body: rendered.body.slice(0, MAX_BODY),
    format: 'yaml-form',
    parsed: rendered.parsed,
  };
}

async function fetchText(env: Env, repo: string, path: string, ref: string): Promise<string | null> {
  const url = buildGitHubUrl(`/repos/${ORG_NAME}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
    ref,
  });
  try {
    const response = await githubGet(url, env, {});
    const payload = (await readJson(response, MAX_FILE_BYTES)) as ContentsPayload;
    return decodeContent(payload);
  } catch {
    // A missing or unreadable template is not an error: skip it.
    return null;
  }
}

/**
 * Read the repository's issue templates.
 *
 * `ref` is the ref the caller is browsing (default branch when omitted).
 */
export async function handleIssueTemplates(repo: string, ref: string | null, env: Env): Promise<IssueTemplate[]> {
  const refParam = ref ?? undefined;
  let candidates: string[] = [];

  try {
    const response = await githubGet(buildGitHubUrl(`/repos/${ORG_NAME}/${encodeURIComponent(repo)}/contents/${TEMPLATE_DIR.split('/').map(encodeURIComponent).join('/')}`, { ref: refParam }), env, {});
    const payload: unknown = await readJson(response);
    if (Array.isArray(payload)) {
      candidates = payload
        .map((entry) => {
          const record = entry as { name?: string; type?: string; size?: number };
          return { name: typeof record.name === 'string' ? record.name : '', type: record.type, size: record.size } as TreeEntry & { name: string };
        })
        .filter((entry) => /\.ya?ml$/i.test(entry.name) || /\.md$/i.test(entry.name))
        .filter((entry) => entry.type === 'file')
        .filter((entry) => (entry.size ?? 0) <= MAX_FILE_BYTES)
        .map((entry) => `${TEMPLATE_DIR}/${entry.name}`)
        .slice(0, MAX_TEMPLATES);
    }
  } catch {
    candidates = [];
  }

  // Legacy single-file templates, only when no directory templates were found.
  if (candidates.length === 0) {
    for (const path of ['.github/ISSUE_TEMPLATE.md', 'ISSUE_TEMPLATE.md']) {
      const text = await fetchText(env, repo, path, ref ?? 'HEAD');
      if (text) {
        candidates = [path];
        break;
      }
    }
  }

  const templates: IssueTemplate[] = [];
  for (const path of candidates.slice(0, MAX_TEMPLATES)) {
    const text = await fetchText(env, repo, path, ref ?? 'HEAD');
    if (text === null) continue;
    templates.push(buildTemplate(path.split('/').pop() ?? path, text));
  }
  if (templates.length === 0) {
    logEvent('debug', 'issue_templates_empty', { repo });
  }
  return templates;
}
