## SystemOverlayButton

**Purpose:** Toolbar control that pops the read-only `SystemOverlay` into an always-on-top Document Picture-in-Picture window and portals the overlay into it.
**File:** `src/components/map/SystemOverlayButton.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| viewData | MapViewData | yes | Live map snapshot, passed through to the portalled `SystemOverlay`. |

### Renders
A ghost `Button` (`PictureInPicture2` icon, "Overlay") in the map toolbar. When the PiP window is open the button switches to the `secondary` variant with `aria-pressed`. On unsupporting browsers it renders a disabled button wrapped in a `Tooltip` explaining the Chromium-only requirement.

### Behaviour & Interactions
- Uses `useDocumentPip()`; click toggles `open()` / `close()`. The window reopens at the size and position the pilot last left it; the first ever open uses `DEFAULT_PIP_WINDOW_SIZE` — deliberately small, so the always-on-top window steals minimal space from the game client. A remembered width under ~300px reopens clamped and snaps to its true width on the pilot's first click inside the overlay, a browser floor `useDocumentPip` works around rather than a choice made here. `open()` runs inside the click handler so it satisfies Document PiP's user-gesture requirement.
- While `pipWindow` is set, renders `createPortal(<SystemOverlay viewData={viewData} />, pipWindow.document.body)`. The portalled child stays in the same React tree, so it resolves the presence + active-character contexts that wrap the toolbar.
- When `!isSupported`, the button is disabled and wrapped in a `Tooltip.Trigger` span (a bare disabled button wouldn't fire the hover events the tooltip needs).
- Closing the PiP via its own ✕ resets the button to the "open" affordance (the hook's `pagehide` handler clears `pipWindow`).

### Depends On
- `useDocumentPip` (`./useDocumentPip`), `SystemOverlay` (`./SystemOverlay`)
- `Button` (`@/components/ui/button`), `Tooltip` (`@base-ui/react/tooltip`), `PictureInPicture2` (`lucide-react`), `createPortal` (`react-dom`)
- Type `MapViewData` (`@/types`)
