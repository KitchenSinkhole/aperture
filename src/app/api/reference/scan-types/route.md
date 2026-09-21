## route.ts (POST /api/reference/scan-types)

**Purpose:** Classify the type ids one D-Scan reported so the overlay can tell ships from the rest of a scan (capsules included — they are in that category).
**File:** `src/app/api/reference/scan-types/route.ts`

---

### POST /api/reference/scan-types
Auth: any authenticated character (401 otherwise). Static SDE reference data, not map-scoped.

**Body:** `{ typeIds: number[] }` — positive integers, at most 2000, which is well past what one scan can hold.

**Responses:** `200 { ok: true, data: ScanTypeRow[] }`; `400` malformed JSON or body; `401` not signed in.

Only ids the SDE carries appear in `data`. A requested id missing from the reply means this build has never heard of it, which the browser side keeps distinct from a known non-ship.

The browser side caches per type id for the session (`fetchScanTypes`, `src/lib/reference/client.ts`) and asks only about ids it has not seen, so repeat scans of the same system usually cost no request at all.
