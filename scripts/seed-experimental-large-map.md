## seed-experimental-large-map.ts

**Purpose:** Dev-only idempotent seed for a 120-system wormhole grid map used to eyeball experimental UI performance.
**File:** `scripts/seed-experimental-large-map.ts`

---

### main()
Deletes any prior map named `BUILD2 Perf Chain`, inserts systems on a 12-column grid with a linear wormhole chain, prints `{ mapId, systems, seedMs }`.
