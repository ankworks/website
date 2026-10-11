/**
 * remark plugin: turn GitHub-style alert blockquotes into callouts.
 *
 *   > [!NOTE]
 *   > Useful information.
 *
 * The plugin only rewrites a blockquote whose first paragraph starts with a
 * known marker, and it keeps every remaining block as ordinary Markdown — so
 * lists, code fences, and nested formatting inside an alert still render (and
 * are still sanitized) exactly as before.
 *
 * It emits mdast nodes carrying `data.hName` / `data.hProperties`, which
 * `mdast-util-to-hast` turns into:
 *
 *   <div data-alert="NOTE">
 *     <p data-alert-title><strong>Note</strong></p>
 *     …remaining blocks…
 *   </div>
 *
 * Data attributes (not class names) are used on purpose: the sanitizer schema
 * can then allow exactly these two attributes instead of a blanket `class`.
 */

import { ALERT_LABELS, parseAlertMarker, type AlertType } from './markdown-alerts';

/**
 * Structural subset of mdast. Typed locally so this module does not depend on
 * packages that are only present transitively through react-markdown.
 */
interface Node {
  type: string;
  value?: string;
  children?: Node[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

const ALERT_NODE = 'githubAlert';
const ALERT_TITLE_NODE = 'githubAlertTitle';

function textNode(value: string): Node {
  return { type: 'text', value };
}

function titleNode(type: AlertType): Node {
  return {
    type: ALERT_TITLE_NODE,
    data: { hName: 'p', hProperties: { dataAlertTitle: '' } },
    children: [{ type: 'strong', children: [textNode(ALERT_LABELS[type])] }],
  };
}

/** True when the node is the paragraph that may carry the marker. */
function firstParagraph(node: Node | undefined): Node | undefined {
  if (!node || node.type !== 'paragraph') return undefined;
  return node;
}

function firstTextOf(paragraph: Node): string | null {
  const first = paragraph.children?.[0];
  if (!first) return null;
  if (first.type === 'text' && typeof first.value === 'string') return first.value;
  return null;
}

/**
 * Rewrite one blockquote. Returns the replacement node, or null if this is not
 * an alert.
 */
function toAlert(blockquote: Node): Node | null {
  const paragraph = firstParagraph(blockquote.children?.[0]);
  if (!paragraph) return null;
  const text = firstTextOf(paragraph);
  if (text === null) return null;

  const marker = parseAlertMarker(text);
  if (!marker) return null;

  // Rebuild the first paragraph without the marker line.
  const restChildren = (paragraph.children ?? []).slice();
  restChildren[0] = textNode(marker.rest);

  // GitHub drops the marker line entirely; if that leaves the paragraph empty
  // (a marker with no body), the callout still needs a title and no content.
  const head: Node = { ...paragraph, children: restChildren };
  const hasContent = restChildren.some((child) => !(child.type === 'text' && child.value?.trim() === ''));
  const remaining = (blockquote.children ?? []).slice(1);

  return {
    type: ALERT_NODE,
    data: { hName: 'div', hProperties: { dataAlert: marker.type } },
    children: [titleNode(marker.type), ...(hasContent ? [head] : []), ...remaining],
  };
}

/** Recursively transform every blockquote in the tree (depth-first, bottom-up). */
function transform(node: Node): void {
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) transform(child);

  const next: Node[] = [];
  for (const child of node.children) {
    if (child.type === 'blockquote') {
      const alert = toAlert(child);
      next.push(alert ?? child);
      continue;
    }
    next.push(child);
  }
  node.children = next;
}

/**
 * remark plugin factory.
 *
 * `remark-alerts` is registered before `remark-gfm` output is converted, so the
 * callout is part of the mdast tree and every nested block is still parsed as
 * Markdown.
 */
export function remarkAlerts() {
  return (tree: Node): void => {
    transform(tree);
  };
}

export { ALERT_NODE, ALERT_TITLE_NODE };
