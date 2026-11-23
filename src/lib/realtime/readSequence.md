## readSequence.ts

**Purpose:** Orders overlapping async reads of one value so the newest successful read wins and the caller knows when the applied value is current.
**File:** `src/lib/realtime/readSequence.ts`

---

### class ReadSequence
Ticket counter for one value. The WS server keeps one for the Blackout switch and one per session socket for its standing (`wsServer.ts`). Starts settled; callers that need "unsettled until the first read" call `invalidate()` once at creation.

- **begin(): number** — starts a read and returns its ticket (strictly increasing).
- **succeed(ticket): boolean** — records a successful read; true (apply its result) only when the ticket is newer than the last applied one. A slow older success never overwrites a newer one, and a newer failure never discards an older success.
- **fail(ticket): void** — records a failed read: unsettled until a read with a later ticket succeeds. A success already applied from a later ticket keeps it settled.
- **invalidate(): void** — the value may have changed: unsettled until a read begun after this call succeeds. A read already in flight does not settle it. Overlapping calls require a read begun after the last one.
- **settled: boolean** — whether the applied read is known to be current.
