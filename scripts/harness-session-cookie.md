## harness-session-cookie.ts

**Purpose:** Mint a harness-only Auth.js session cookie for map UI screenshots on port 3005.
**File:** `scripts/harness-session-cookie.ts`

---

### main()
Encodes JWT with `AUTH_SECRET` (default pd harness secret), character `92000101`, sets optional `ap_ui=panels`, writes Playwright `storageState` JSON when `--write <path>` is passed.
