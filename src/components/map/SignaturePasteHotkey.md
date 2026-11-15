## SignaturePasteHotkey

**Purpose:** Fast-scanning CTRL+V — a document-level `paste` listener that applies in-game probe-scanner clipboard data straight to the selected system (skipping the paste dialog), with a mismatch confirm when no viewer pilot is in that system.
**File:** `src/components/map/SignaturePasteHotkey.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | `ap_map.id` as string |
| selectedSystem | MapSystemNode \| null | yes | The currently selected system (paste target) |
| fallbackSystem | MapSystemNode \| null | no | When experimental keep-selection leaves no primary selection, Ctrl+V targets this last-selected system |
| systems | MapSystemNode[] | yes | All on-map systems — used to resolve the viewer's current-location name |
| viewerCharacterIds | number[] | yes | The viewer's account character ids; matched against live presence to find their current location |
| onBulkPaste | (payloads: MapEventPayload[]) => void | yes | Folds the committed events into map state + dedupe set |
| lazyDelete | boolean | yes | One-shot arm (from the Signatures-panel toggle): when true, the next committed direct paste also removes missing sigs |
| onLazyDeleteConsume | () => void | yes | Called to disarm the one-shot once a paste commits |
| onLazyDeletePasteResult | (payloads: MapEventPayload[]) => void | yes | Result handler used in place of `onBulkPaste` for an armed lazy-delete paste; folds the payloads and offers the subchain-delete prompt for each removed wormhole sig |

### Renders
Nothing visible except a shadcn `Dialog` confirm shown when no pilot is in the selected system. Must be rendered inside `MapPresenceProvider`.

### Behaviour & Interactions
- Registers one `document` `paste` listener (registered once; reads latest props + the presence store via a ref so selection/location changes don't re-subscribe).
- Ignores the paste when the event target is editable (`INPUT`/`TEXTAREA`/`SELECT`/contenteditable) — typing into the sig table or the paste dialog's textarea is unaffected.
- Parses clipboard text with `parseSignaturePaste`; if it yields 0 rows (not scanner data) the native paste proceeds untouched. On ≥1 row it `preventDefault()`s.
- No primary selected system uses `fallbackSystem` when provided (experimental UI only); otherwise `toast.info(...)` hint, no apply.

### `resolveSignaturePasteTargetSystem(selectedSystem, fallbackSystem?)`
Returns `selectedSystem ?? fallbackSystem ?? null`.
- Computes the live set of EVE systems the viewer's pilots are in (`viewerCharacterIds.map(getSystemForCharacter)`). **Applies directly only when one of those equals the selected system's EVE id** (fast path). Otherwise opens the confirm dialog — this covers both "your pilot is in a different system" and "none of your pilots is located anywhere" (Cancel aborts, "Apply anyway" applies).
- Confirm copy adapts: names a system a pilot is in when one is known, else "None of your characters is in {target}".
- Apply uses `applySignaturePaste` with `FAST_PASTE_OPTIONS` (add + update, never remove) — unless the one-shot `lazyDelete` arm is set, in which case it uses `LAZY_DELETE_PASTE_OPTIONS` (add + update + remove-missing) and routes the result through `onLazyDeletePasteResult` (which folds the paste *and* raises the subchain-delete prompt for each removed wormhole sig) instead of `onBulkPaste`. The armed flag is captured at apply time and only consumed (`onLazyDeleteConsume`) once the paste actually commits, so a failed paste leaves it armed to retry. Applies to both the fast path and the confirm-dialog "Apply anyway" path.

### Emits / Calls
- `usePresenceStore()` — read live at paste time via `getSystemForCharacter(id)`.
- `applySignaturePaste({ mapId, mapSystemId, rows, onResult })` — POST + toast.
- `onBulkPaste(payloads)` via the helper's `onResult`.

### Depends On
- `parseSignaturePaste` (`src/lib/map/signatureParser.ts`)
- `applySignaturePaste` / `FAST_PASTE_OPTIONS` (`src/lib/map/applySignaturePaste.ts`)
- `usePresenceStore` (`src/components/map/MapPresenceContext.tsx`)
- shadcn `Dialog` (`src/components/ui/dialog.tsx`), `Button`

### Local State
- `confirm: { rows, targetSystem, locationName } | null` — drives the confirm dialog; `locationName` is null when no pilot is located anywhere
