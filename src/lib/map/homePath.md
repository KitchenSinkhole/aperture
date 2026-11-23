## homePath.ts

**Purpose:** Derive which map connections lie on the spanning tree from the designated Home system.
**File:** `src/lib/map/homePath.ts`

---

### homePathConnectionIds(homeMapSystemId, connections): ReadonlySet&lt;string&gt;
Breadth-first walk from `homeMapSystemId` over undirected connections. Each system is reached once; the edge used to discover it is included. Returns an empty set when Home is unset.
