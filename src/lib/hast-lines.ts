/**
 * Minimal HAST model and line splitting for syntax-highlighted output.
 *
 * lowlight returns a tree of <span> elements with class names. Converting it to
 * React elements (never innerHTML) requires splitting nodes at newlines so each
 * source line can carry its own line number. Spans that cross a newline are
 * cloned for every line they touch.
 */
export type HastText = { type: 'text'; value: string };
export type HastElement = {
  type: 'element';
  tagName: string;
  properties: { className?: string[] } & Record<string, unknown>;
  children: HastNode[];
};
export type HastNode = HastText | HastElement;

export function splitHastLines(nodes: HastNode[]): HastNode[][] {
  const lines: HastNode[][] = [[]];
  for (const node of nodes) {
    if (node.type === 'text') {
      node.value.split('\n').forEach((part, index) => {
        if (index > 0) lines.push([]);
        if (part !== '') lines[lines.length - 1].push({ type: 'text', value: part });
      });
    } else {
      const childLines = splitHastLines(node.children);
      childLines.forEach((children, index) => {
        if (index > 0) lines.push([]);
        if (children.length > 0) {
          lines[lines.length - 1].push({ ...node, children });
        }
      });
    }
  }
  return lines;
}

/** Plain text lines, used when highlighting is unavailable. */
export function plainLines(code: string): HastNode[][] {
  return splitHastLines([{ type: 'text', value: code }]);
}
