## experimentalUi.client.ts

**Purpose:** Client hook to read and update the experimental UI mode in place (cookie + `<html>` attributes).
**File:** `src/lib/experimentalUi.client.ts`

### useExperimentalUi(serverInitial?: ExperimentalUiMode): [ExperimentalUiMode, (mode) => void]
State is seeded from `serverInitial` on the map page (cookie from SSR) so the first client render matches the server; otherwise falls back to `readExperimentalUiFromHtml()`. The setter calls `writeExperimentalUi`.
