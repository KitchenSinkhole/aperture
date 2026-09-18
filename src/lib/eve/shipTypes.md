## shipTypes.ts

**Purpose:** Read every published Ship-category type id, with its group, from the ingested SDE.
**File:** `src/lib/eve/shipTypes.ts`

`server-only`. The authoritative answer to "is this type id a ship?", which a D-Scan paste needs because a scan reports everything in range — structures, probes, drones, wrecks — through the same columns as hulls. Membership is the SDE's own `Ship` category, so capsules count as ships. It comes from the ingested SDE, so a hull released after any given build classifies as soon as the SDE refresh picks it up.

---

### shipTypeGroups(): Promise\<ShipTypeGroupRow[]\>
Joins `universe_type` → `universe_group` → `universe_category`, filtered to the `Ship` category and `published` types, ordered by type id. The group id rides along so the caller can resolve a `ShipClass` for a hull no tracked pilot is flying, through the same group table `resolveShipClass` uses.

**Returns:** One row per published hull.

---

### Types
- `ShipTypeGroupRow = { typeId, groupId }`

Re-exported from `src/types/index.ts`.
