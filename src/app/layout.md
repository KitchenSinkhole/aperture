## RootLayout

**Purpose:** Top-level App Router layout. Wraps every route in the HTML/body shell, sets page metadata, applies the Geist sans-serif font, and imports global Tailwind tokens.
**File:** `src/app/layout.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| children | ReactNode | yes | Page subtree rendered inside `<body>`. |

### Renders
`<html lang="en">` with the Geist font CSS variable and a `dark font-sans` class, wrapping `<body>{children}</body>`. Imports `./globals.css` (shadcn-generated Tailwind v4 tokens) once at the root. The `dark` class is hard-coded on `<html>` — the app is permanently dark mode (no theme toggle), which activates the `.dark` token overrides in `globals.css`. The optional `low-contrast` class (applied client-side by `LowContrastController` in the `(app)` layout, toggled live from the map Settings tab) layers the softer `.dark.low-contrast` overrides on top.

### Exports
- Default: `RootLayout`
- Named: `metadata` — `next.Metadata` for the document `<title>` and description, plus `metadataBase` (from `env.AUTH_URL`) so relative OG image URLs resolve to absolute ones in unfurl cards. Omitted when the deployment has not declared its origin.

### Depends on
- `next/font/google` — Geist font.
- `@/lib/env` — `env.AUTH_URL` for `metadataBase`.
- `@/lib/utils` — `cn` className helper.
- `./globals.css` — Tailwind v4 base + shadcn theme tokens.
