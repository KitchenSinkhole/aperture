// Colored-text support for map-note content, layered on top of GitHub-flavoured
// markdown (react-markdown + remark-gfm). The tag syntax is `[color]text[/color]`
// with a fixed, named palette — never arbitrary CSS — so rendering stays
// XSS-safe without enabling raw HTML. The remark plugin rewrites matching text
// runs into `span` nodes carrying an inline colour from the palette.

/** Named text colours usable in note content via `[name]…[/name]`. */
export const NOTE_TEXT_COLORS: Record<string, string> = {
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  orange: '#f97316',
  blue: '#3b82f6',
  purple: '#a855f7',
  cyan: '#2dd4bf',
  gray: '#9ca3af',
  grey: '#9ca3af',
};

/** The distinct colour names to surface in help text (drops the `grey` alias). */
export const NOTE_TEXT_COLOR_NAMES = Object.keys(NOTE_TEXT_COLORS).filter((c) => c !== 'grey');

// `[red]…[/red]` with the closing tag matching the opener. Non-greedy body so
// adjacent tags don't merge. Built once from the palette keys.
const COLOR_TAG = new RegExp(
  `\\[(${Object.keys(NOTE_TEXT_COLORS).join('|')})\\]([\\s\\S]*?)\\[\\/\\1\\]`,
  'g',
);

// Minimal mdast shape — avoids a hard dependency on `@types/mdast`.
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
}

// Split one text node into a run of plain-text and coloured `span` nodes. A
// coloured node uses the mdast→hast `hName`/`hProperties`/`hChildren` escape
// hatch so it renders as `<span style="color:…">text</span>` with a palette
// colour (the regex only matches known names, so the style is never user CSS).
// Colour tags wrap plain text; markdown formatting inside a tag is parsed into
// separate nodes and won't be recoloured.
function splitText(node: MdNode): MdNode[] {
  const value = node.value ?? '';
  const out: MdNode[] = [];
  let last = 0;
  for (const match of value.matchAll(COLOR_TAG)) {
    const start = match.index ?? 0;
    if (start > last) out.push({ type: 'text', value: value.slice(last, start) });
    const color = NOTE_TEXT_COLORS[match[1]!]!;
    const inner = match[2] ?? '';
    out.push({
      type: 'colorSpan',
      data: {
        hName: 'span',
        hProperties: { style: `color:${color}` },
        hChildren: [{ type: 'text', value: inner }],
      },
    });
    last = start + match[0].length;
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out.length > 0 ? out : [node];
}

function transform(node: MdNode): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text') {
      next.push(...splitText(child));
    } else {
      transform(child);
      next.push(child);
    }
  }
  node.children = next;
}

/** remark plugin: rewrite `[color]…[/color]` runs into palette-coloured spans. */
export function remarkColorTags() {
  return (tree: MdNode) => transform(tree);
}
