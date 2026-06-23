## noteMarkdown.ts

**Purpose:** Colored-text support for map-note content — a named-colour palette plus a remark plugin that rewrites `[color]…[/color]` tags into palette-coloured spans, layered on top of GFM markdown.
**File:** `src/lib/map/noteMarkdown.ts`

Note content renders through `react-markdown` + `remark-gfm` (the same stack as `ChangelogDialog`). This module adds the colour layer. The tag syntax is `[name]text[/name]` with a fixed palette — the rendered colour is always a known hex, never user-supplied CSS — so colours work without enabling raw HTML and stay XSS-safe. Colour tags wrap plain text; markdown formatting placed inside a tag is parsed into separate nodes and won't be recoloured.

---

### NOTE_TEXT_COLORS: Record<string, string>
Named text colours → hex. Keys: `red`, `green`, `yellow`, `orange`, `blue`, `purple`, `cyan`, `gray` (+ `grey` alias). Hues echo the map palette.

### NOTE_TEXT_COLOR_NAMES: string[]
The distinct colour names (drops the `grey` alias) — for help text listing the available tags.

### remarkColorTags(): (tree) => void
A remark (mdast) plugin. Walks the tree and splits text nodes on `[color]…[/color]`, replacing each match with a `span` node carrying an inline palette colour via the mdast→hast `hName`/`hProperties`/`hChildren` escape hatch. Pass it in `remarkPlugins` after `remarkGfm`. Used by `NoteContent`.

### Depends On
- Nothing external (minimal local mdast node shape; no `@types/mdast` dependency).
