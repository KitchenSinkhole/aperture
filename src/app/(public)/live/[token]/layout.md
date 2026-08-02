## PublicMapLayout

**Purpose:** Full-bleed shell for the spectator view at `/live/[token]`.
**File:** `src/app/(public)/live/[token]/layout.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| children | ReactNode | yes | The spectator page |

### Renders
A viewport-height, overflow-hidden column on the app background. The `(public)` group carries no layout of its own, so this sits directly inside the root layout: the map gets the whole viewport with no app header, footer or sidebar, and nothing here reads a session.
