## PublicMapLayout

**Purpose:** Full-bleed shell for the spectator view at `/live/[token]`.
**File:** `src/app/(public)/live/[token]/layout.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| children | ReactNode | yes | The spectator page |

### Renders
A viewport-height, overflow-hidden column. The `(public)` group carries no layout of its own, so this sits directly inside the root layout: the map gets the whole viewport with no app header, footer or sidebar, and nothing here reads a session.

Carries the `spectator` class, which scopes the view's own palette (defined in `globals.css`) — those tokens resolve nowhere else in the app. Loads Geist Mono as `--font-spec-mono`; it is this page's dominant voice and no other route uses it.
