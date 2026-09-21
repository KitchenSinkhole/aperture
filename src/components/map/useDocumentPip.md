## useDocumentPip.ts

**Purpose:** Client hook owning one Document Picture-in-Picture window's lifecycle — opens an OS-level always-on-top window, clones the opener's stylesheets + theme into it, and exposes it as a portal target.
**File:** `src/components/map/useDocumentPip.ts`

---

### useDocumentPip(): DocumentPipController
Returns a controller for a single PiP window. Reads `window.documentPictureInPicture` (Chromium 116+); on the server and in unsupporting browsers `isSupported` is false and `open()` is a no-op.

**Returns:** `DocumentPipController`:
- `pipWindow: Window | null` — the live PiP window (portal target via `createPortal(..., pipWindow.document.body)`), or null when closed.
- `isOpen: boolean` — `pipWindow !== null`.
- `isSupported: boolean` — Chromium-only capability flag, resolved through `useSyncExternalStore` so the server snapshot is false and the client snapshot is the real capability — avoids a hydration mismatch on a consumer's disabled state.
- `open(): Promise<void>` — `await window.documentPictureInPicture.requestWindow(...)`. **Must be called from a user gesture.** Dimensions are passed only when nothing is stored yet (`DEFAULT_PIP_WINDOW_SIZE`); on every later open the request carries no dimensions, because passing them forces initial placement and discards the size *and* position Chromium remembers from the last close. Chromium will not open a PiP window narrower than roughly 300px, so a narrower remembered width arrives clamped and is corrected on the pilot's first interaction inside the window (see below). Clones every `<style>` / `<link rel="stylesheet">` from `document.head` into the PiP document (dev = `<style>`, prod = `<link>`), mirrors `document.documentElement.className` (the `.dark` custom-variant class), and sets `body` to `bg-background text-foreground min-h-screen` so the dark surface fills the window. Wires the window's `pagehide` to flush the size and clear state.
- `close(): void` — closes the window and clears state.

### Behaviour
- The window is closed on component unmount (a cleanup effect keyed on `pipWindow`), on explicit `close()`, and when the user closes the PiP chrome (`pagehide` clears state).
- Document PiP requires the opener tab to stay open; closing the opener closes the PiP automatically.
- The window's `resize` event is watched (debounced 300ms) and its **outer** size persisted via `writePipWindowSize` — the units `resizeTo` takes, so restoring needs no conversion between viewport and window dimensions.
- Resizes arriving in the first `POST_OPEN_SETTLE_MS` after opening are not persisted, and neither is a `pagehide` inside that window. Chromium emits several resizes of its own while the window settles, at the size it chose; persisting them would overwrite a remembered narrow size with a clamped one before the pilot could act.
- When a size was already stored, the first `pointerdown` or `keydown` **inside the PiP document** reapplies it with `resizeTo`, then unsubscribes. `resizeTo` reaches below the ~300px floor that `requestWindow` cannot, and needs a user activation that `requestWindow` has consumed — an interaction inside the window supplies a fresh one. The size is re-read at that moment, so a resize the pilot made first wins, and a matching size is left alone.
- On `pagehide` the pending debounce is cleared, the `resize` listener removed, and the size flushed once more. A closed PiP window reports its dimensions as 0, so the size must be captured while the window is still measurable; `writePipWindowSize` discards an out-of-range value if it isn't.

### Depends On
- `window.documentPictureInPicture` (declared inline — not yet in the DOM lib).
- `readPipWindowSize` / `writePipWindowSize` / `DEFAULT_PIP_WINDOW_SIZE` (`@/lib/pipWindowPrefs`) for cross-session size persistence.
