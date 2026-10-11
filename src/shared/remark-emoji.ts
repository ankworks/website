/**
 * remark plugin: expand GitHub emoji shortcodes (`:tada:` → 🎉).
 *
 * Text inside code spans, code fences, and link/image URLs is left alone, so a
 * `:smile:` in a code sample stays literally `:smile:`.
 */

import { expandEmojiShortcodes } from './emoji';

interface Node {
  type: string;
  value?: string;
  children?: Node[];
}

/** Node types whose text must never be rewritten. */
const VERBATIM = new Set(['inlineCode', 'code', 'definition', 'link', 'image', 'html']);

export function remarkEmoji() {
  return (tree: Node): void => {
    walk(tree);
  };
}

function walk(node: Node): void {
  if (typeof node.value === 'string' && !VERBATIM.has(node.type)) {
    node.value = expandEmojiShortcodes(node.value);
  }
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) walk(child);
}
