## SystemOverlayButton

**Purpose:** Toolbar control that pops the read-only `SystemOverlay` into an always-on-top Document Picture-in-Picture window and portals the overlay into it.
**File:** `src/components/map/SystemOverlayButton.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| viewData | MapViewData | yes | Live map snapshot, passed through to the portalled `SystemOverlay`. |
| overlayFitOverflow | OverlayFitOverflow | yes | Instance-wide overlay fit-columns overflow policy, passed through as the overlay's `fitOverflow`. |

### Renders
A ghost `Button` (`PictureInPicture2` icon, "Overlay") in the map toolbar. When the PiP window is open the button switches to the `secondary` variant with `aria-pressed`. On unsupporting browsers it renders a disabled button wrapped in a `Tooltip` explaining the Chromium-only requirement.

### Behaviour & Interactions
- Uses `useDocumentPip()`; click toggles `open({ width: 260, height: 320 })` / `close()` (a deliberately small default so the always-on-top window steals minimal space from the game client; the user can still resize it). That default only applies the first time the window is ever opened — `useDocumentPip` remembers whatever size the user last resized it to and reopens there instead. `open()` runs inside the click handler so it satisfies Document PiP's user-gesture requirement.
- While `pipWindow` is set, renders `createPortal(<SystemOverlay viewData={viewData} fitOverflow={overlayFitOverflow} />, pipWindow.document.body)`. The portalled child stays in the same React tree, so it resolves the presence + active-character contexts that wrap the toolbar.
- When `!isSupported`, the button is disabled and wrapped in a `Tooltip.Trigger` span (a bare disabled button wouldn't fire the hover events the tooltip needs).
- Closing the PiP via its own ✕ resets the button to the "open" affordance (the hook's `pagehide` handler clears `pipWindow`).

### Depends On
- `useDocumentPip` (`./useDocumentPip`), `SystemOverlay` (`./SystemOverlay`)
- `Button` (`@/components/ui/button`), `Tooltip` (`@base-ui/react/tooltip`), `PictureInPicture2` (`lucide-react`), `createPortal` (`react-dom`)
- Types `MapViewData`, `OverlayFitOverflow` (`@/types`)
