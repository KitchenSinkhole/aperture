## IntroCard

**Purpose:** A one-time card explaining what a spectator is looking at and pointing at the entrances board and the app.
**File:** `src/components/public/IntroCard.tsx`

### Props
None.

### Renders
A bordered card over the canvas: an eyebrow, a short description of Aperture and this page, a pointer to the entrances board, a `Map your own chain` link to the deployment root, and a dismiss button.

### Behaviour & Interactions
- Dismissal persists to `localStorage` under `aperture:spectator:intro`, so a returning visitor never sees it again.
- The dismissal is read through `useSyncExternalStore` against a module-level store: the server snapshot reports dismissed, so the card never renders on the server and a returning visitor sees no flash of a card that then vanishes. A storage failure (private mode, blocked quota) falls back to showing the card and to dismissing it for the session only.
