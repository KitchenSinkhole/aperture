## overlayColumnPrefs.ts

**Purpose:** localStorage persistence for the system overlay's resizable pilot-column widths.
**File:** `src/lib/map/overlayColumnPrefs.ts`

Client-only. The overlay lives in a Document PiP window that is torn down and recreated on every open, so storage is the only place a width survives. Only the two leading columns (`pilot`, `name`) are stored; the trailing `type` column takes the leftover width, which is what lets a wider window widen it.

---

### OVERLAY_COLUMN_WIDTHS_KEY
`'aperture:overlay-column-widths'` — the localStorage key holding both widths as one JSON blob.

### DEFAULT_OVERLAY_COLUMN_WIDTHS
`{ pilot: 92, name: 92 }` — used until the pilot drags or fits the columns.

---

### readOverlayColumnWidths(): OverlayColumnWidths | null
**Returns:** the stored widths, or `null` when nothing usable is stored. A width outside `MIN_OVERLAY_COLUMN_PX … MAX_OVERLAY_COLUMN_PX` ([[overlayColumnFit]]) invalidates the whole blob, as does unparseable JSON or unavailable storage.

### writeOverlayColumnWidths(widths: OverlayColumnWidths): void
Persists both widths. A width outside the valid range is discarded rather than stored; a storage failure is swallowed.
