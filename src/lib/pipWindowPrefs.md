## pipWindowPrefs.ts

**Purpose:** Client-only localStorage read/write for the remembered size of the Document Picture-in-Picture overlay window.
**File:** `src/lib/pipWindowPrefs.ts`

---

### PipWindowSize
`{ width: number; height: number }` — the overlay window's **outer** size in CSS pixels, the units `Window.resizeTo` takes. The PiP title bar makes outer height roughly 98px larger than the viewport.

### DEFAULT_PIP_WINDOW_SIZE
`{ width: 260, height: 320 }` — the size the overlay opens at before the pilot has resized it.

### PIP_WINDOW_SIZE_KEY
The localStorage key (`'aperture:pip-window-size'`) holding the JSON blob.

---

### readPipWindowSize(): PipWindowSize | null
Returns the stored size, or `null` when storage is empty, unparseable, inaccessible, or holds a dimension outside the valid range (120–4000 px). `null` means the overlay has never been sized on this browser profile, so a caller opens it at `DEFAULT_PIP_WINDOW_SIZE`; a non-null value means Chromium holds its own memory of the window's size and position, which a caller preserves by requesting the window without dimensions.

A closing PiP window reports its dimensions as 0, and Chromium answers a 0 or out-of-range request by substituting its own default size — so the range check, not just a type check, is what keeps a bad value from being replayed as a window size.

### writePipWindowSize(size: PipWindowSize): void
JSON-stringifies and persists the size, swallowing storage errors. A dimension outside the valid range is discarded rather than stored.
