## eolMinuteTick.ts

**Purpose:** Shared one-minute tick for EOL countdown labels on connection edges.
**File:** `src/lib/map/eolMinuteTick.ts`

---

### subscribeMapMinuteTick(listener): () => void
Registers a listener; one interval backs every subscriber.

### useMapMinuteTick(): number
React hook returning `Date.now()`, updated on the shared minute tick while mounted.
