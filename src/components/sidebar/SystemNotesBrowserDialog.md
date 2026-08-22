## SystemNotesBrowserDialog

**Purpose:** Notes browser — search every system note the viewer's scope admits, by body text, system name, or category chip, and jump to a result's system.
**File:** `src/components/sidebar/SystemNotesBrowserDialog.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| open | boolean | yes | Dialog visibility |
| onOpenChange | (open: boolean) => void | yes | Dialog open/close |
| categories | SystemNoteCategoryDef[] | yes | The deployment's vocabulary, for chip colours on results |
| onJumpToSystem | (systemId: number) => void | yes | Called with a clicked result's EVE system id |

### Renders
A dialog with a search input (icon, inline spinner while searching) and a height-capped scrollable result list. Each result is a clickable row (`role="button"` div, not a `<button>` — the markdown body can contain links, and interactive content inside a button is invalid HTML) showing the system name, scope chip, category chip (if any), a 3-line-clamped markdown body preview, and author · age.

### Behaviour & Interactions
- Debounced search (250ms) via `searchSystemNotesOnServer`; queries under 2 chars show a hint and clear results without a request. Stale responses are dropped via a sequence counter; a failed request clears the list rather than leaving the previous query's hits.
- A click that originates on a link inside the body follows the link only; clicks elsewhere on the row (or Enter/Space) fire `onJumpToSystem`.
- Results are newest-first, scope-filtered server-side (before the cap), and capped server-side.
- The search UI is mounted only while the dialog is open, so query/results reset on each open.
- Whether a clicked system can actually be focused is the parent's concern (`MapCanvas` toasts when the system isn't on the current map).

### Depends On
- `searchSystemNotesOnServer` (`@/lib/system-notes/client`).
- `NoteContent` — markdown preview; `CategoryChip` (`./SystemNotesModule`); `IntelScopeChip` (`./IntelScopeChip`).
- `Dialog` primitives, `Input`.

### Local State
- `query: string`, `results: SystemNoteSearchResult[]`, `searching: boolean`.
