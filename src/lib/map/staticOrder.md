## staticOrder.ts

**Purpose:** Display order for a system's static wormhole target-class labels.
**File:** `src/lib/map/staticOrder.ts`

Pure and dependency-free, so both the authed map node and the public spectator node can sort statics identically without either importing the other's component tree.

---

### staticCompare(a: string, b: string): number
Comparator for static target-class labels. Orders wormhole classes ascending (`C1`…`C6`) first, then k-space by danger (`H` < `L` < `0.0` < `P`), then anything unrecognised.
