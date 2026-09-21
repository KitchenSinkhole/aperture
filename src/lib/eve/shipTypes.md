## shipTypes.ts

**Purpose:** Classify scanned type ids against the ingested SDE — ship, non-ship, or unknown to this build.
**File:** `src/lib/eve/shipTypes.ts`

`server-only`. The authoritative answer to "is this type id a ship?", which a D-Scan paste needs because a scan reports everything in range — structures, probes, drones, wrecks — through the same columns as hulls. Membership is the SDE's own `Ship` category, so capsules count as ships and an unpublished hull still classifies as one.

---

### classifyScanTypes(typeIds: readonly number[]): Promise\<ScanTypeRow[]\>
Joins `universe_type` → `universe_group` → `universe_category` for the requested ids, deduplicated, and reports each id's group plus whether its category is `Ship`. An empty input returns an empty array without a query.

Only ids the SDE carries come back. An id absent from the result is one this build has never heard of, which is a distinct answer from "known, and not a ship": the caller must not collapse the two, because a hull newer than the ingested SDE lands in the first bucket and an intel panel that drops it renders a hostile invisible. The group id rides along so the caller can resolve a `ShipClass` for a hull no tracked pilot is flying, through the same group table `resolveShipClass` uses.

**Parameters:**
- `typeIds` — the type ids a single scan reported.

**Returns:** One row per requested id the SDE carries.

---

### Types
- `ScanTypeRow = { typeId, groupId, isShip }`

Re-exported from `src/types/index.ts`.
