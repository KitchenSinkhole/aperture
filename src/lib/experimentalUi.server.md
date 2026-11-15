## experimentalUi.server.ts

**Purpose:** Server-only reader for the experimental UI cookie on App Router requests.
**File:** `src/lib/experimentalUi.server.ts`

---

### getExperimentalUiFromCookies(): Promise<ExperimentalUiMode>
Reads `ap_ui` from request cookies and parses it through `parseApUiCookie`.