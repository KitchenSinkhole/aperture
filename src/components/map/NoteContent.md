## NoteContent

**Purpose:** Renders a map note's markdown `content` — GitHub-flavoured markdown plus `[color]…[/color]` text tags.
**File:** `src/components/map/NoteContent.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| content | string | yes | The note's raw markdown source. |
| className | string | no | Sizing / clamping for the surface (e.g. `line-clamp-2` on the node snippet). |

### Renders
`react-markdown` with `remarkGfm` + `remarkColorTags` and a compact element-styling `components` map (the project has no Tailwind typography plugin). Body text is **muted** (`text-muted-foreground`) by default — like the changelog — so headings (escalating sizes) and `**bold**` (`text-foreground`) pop against it on the dark theme. Blocks stack with a small gap and no leading top margin so a clamped preview reads cleanly. Links open in a new tab.

### Behaviour & Interactions
- Colour tags (`[red]…[/red]`, etc.) render via `remarkColorTags` using the fixed `NOTE_TEXT_COLORS` palette — no raw HTML, so user content can't inject markup/CSS.
- Used by `MapNoteNode` (the on-canvas snippet, line-clamped, and the full hover tooltip) and `InspectorModule`'s `NoteInspector` (the live preview under the content editor).

### Depends On
- `react-markdown`, `remark-gfm`
- `remarkColorTags` (`@/lib/map/noteMarkdown`)
- `cn` (`@/lib/utils`)
