## overlayColumnPrefs.ts

**Purpose:** localStorage persistence for the proportions of the system overlay's resizable pilot columns.
**File:** `src/lib/map/overlayColumnPrefs.ts`

Client-only. The overlay lives in a Document PiP window that is torn down and recreated on every open, so storage is the only place a layout survives. Widths are held as fractions of the resizable pool rather than pixels, so a layout stored at one window size is meaningful at any other. Only the two leading columns (`pilot`, `name`) are stored; the trailing `type` column takes the remainder, so its share is implied.

---

### OVERLAY_COLUMN_WIDTHS_KEY
`'aperture:overlay-column-widths'` — the localStorage key holding both fractions as one JSON blob.

### DEFAULT_OVERLAY_COLUMN_FRACTIONS
`{ pilot: 0.38, name: 0.38 }` — used until the pilot drags, fits, or evens the columns.

---

### readOverlayColumnFractions(): OverlayColumnFractions | null
**Returns:** the stored fractions ([[overlayColumnFit]]), or `null` when nothing usable is stored. A share outside `0 … 1` exclusive invalidates the whole blob, as does a pair summing to `1` or more (which would leave the trailing column nothing), unparseable JSON, or unavailable storage.

### writeOverlayColumnFractions(fractions: OverlayColumnFractions): void
Persists both fractions. A blob failing the same validity rules is discarded rather than stored; a storage failure is swallowed.
