## route.ts (GET /api/reference/ship-types)

**Purpose:** Serve the published Ship-category type ids so the overlay can tell ships from the rest of a D-Scan (capsules included — they are in that category).
**File:** `src/app/api/reference/ship-types/route.ts`

---

### GET /api/reference/ship-types
Auth: any authenticated character (401 otherwise). Returns `shipTypeGroups()` — static SDE reference data, not map-scoped. No params.

**Responses:** `200 { ok: true, data: ShipTypeGroupRow[] }`; `401` not signed in.

The browser side memoises the first success for the session (`fetchShipTypeGroups`, `src/lib/reference/client.ts`), so a second D-Scan paste costs no request.
