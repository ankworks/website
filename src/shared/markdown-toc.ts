/**
 * Heading anchors and table-of-contents extraction for rendered Markdown.
 *
 * Slugs follow GitHub's heading anchor rules: lowercase, punctuation removed,
 * spaces to hyphens. Duplicate headings get "-1", "-2", … suffixes so every
 * anchor in a document is unique.
 *
 * `remarkHeadingIds` assigns the same slugs to rendered headings (as `id`
 * properties), so table-of-contents links always match the rendered anchors.
 * Keep this module free of DOM APIs so it works in the Worker and the browser.
 */

interface MdastNode {
  type: string;
  depth?: number;
  value?: string;
  alt?: string;
  children?: unknown[];
  data?: { hProperties?: Record<string, unknown> };
}

export interface TocHeading {
  /** Heading level, 1–6. */
  depth: number;
  /** Plain-text heading content shown in the table of contents. */
  text: string;
  /** Unique GitHub-style anchor slug for this heading. */
  slug: string;
}

/** GitHub-style heading anchor: lowercase, punctuation removed, spaces to hyphens. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/**
 * Append GitHub's duplicate-heading suffixes: "intro", "intro-1", "intro-2".
 * The map records how many times each base slug has been used.
 */
function uniqueSlug(base: string, seen: Map<string, number>): string {
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

/** Strip inline Markdown markup so the TOC shows plain text. */
function stripInline(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → link text
    .replace(/`+([^`]*)`+/g, '$1') // code spans
    .replace(/<[^>]+>/g, '') // inline HTML tags
    .replace(/\\([\\`*_{}[\]()#+\-.!~|])/g, '$1') // backslash escapes
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1') // italic (asterisks only; underscores stay)
    .replace(/~~(.+?)~~/g, '$1') // strikethrough
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Collect ATX headings ("# Title") from Markdown source.
 *
 * Headings inside fenced code blocks (``` or ~~~) are ignored. Setext headings
 * are not collected; the rendered anchors still exist via `remarkHeadingIds`,
 * they are simply absent from the outline (rare in practice).
 */
export function extractHeadings(markdown: string): TocHeading[] {
  const headings: TocHeading[] = [];
  const seen = new Map<string, number>();
  let fence: { char: string; length: number } | null = null;

  for (const line of markdown.split('\n')) {
    const fenceMarker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const closes =
        fenceMarker !== null &&
        fenceMarker[1][0] === fence.char &&
        fenceMarker[1].length >= fence.length &&
        line.slice(fenceMarker[0].length).trim() === '';
      if (closes) fence = null;
      continue;
    }
    if (fenceMarker) {
      fence = { char: fenceMarker[1][0], length: fenceMarker[1].length };
      continue;
    }

    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
    if (!atx) continue;
    // Drop a closing hash sequence ("## Title ##") and inline markup.
    const text = stripInline((atx[2] ?? '').replace(/[ \t]+#+[ \t]*$/, ''));
    if (text === '') continue;
    headings.push({ depth: atx[1].length, text, slug: uniqueSlug(slugify(text), seen) });
  }

  return headings;
}

function plainTextOfMdast(node: unknown): string {
  if (Array.isArray(node)) return node.map(plainTextOfMdast).join('');
  if (node === null || node === undefined || typeof node !== 'object') return '';
  const typed = node as MdastNode;
  if (typed.type === 'text' || typed.type === 'inlineCode') return typed.value ?? '';
  if (typed.type === 'image') return typed.alt ?? '';
  if (typed.type === 'html') return (typed.value ?? '').replace(/<[^>]+>/g, '');
  if (Array.isArray(typed.children)) return typed.children.map(plainTextOfMdast).join('');
  return '';
}

/**
 * Remark plugin: set `id` on every heading to its GitHub-style slug (with the
 * same duplicate suffixes `extractHeadings` produces). Runs before the Markdown
 * sanitization step, which allows `id` on h1–h6 only.
 */
export function remarkHeadingIds(): (tree: unknown) => void {
  return (tree: unknown): void => {
    const seen = new Map<string, number>();
    let emptyHeadings = 0;
    const walk = (node: unknown): void => {
      if (node === null || node === undefined || typeof node !== 'object') return;
      const typed = node as MdastNode;
      if (typed.type === 'heading') {
        const text = plainTextOfMdast(typed.children ?? []).trim();
        const base = slugify(text);
        emptyHeadings += 1;
        const slug = base === '' ? `heading-${emptyHeadings}` : uniqueSlug(base, seen);
        typed.data = { ...typed.data, hProperties: { ...typed.data?.hProperties, id: slug } };
      }
      if (Array.isArray(typed.children)) typed.children.forEach(walk);
    };
    walk(tree);
  };
}
