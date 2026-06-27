## bulk/route.ts

**Purpose:** Bulk signature-paste endpoint — diffs incoming rows against existing sigs on a system and commits add/update/remove (+ optional WH-connection tear-down) atomically. Wraps `pasteSignatures` from `bulkSignatures.ts`.
**File:** `src/app/api/map/[mapId]/signatures/bulk/route.ts`

---

### POST /api/map/[mapId]/signatures/bulk
**Body:**
```ts
{
  mapSystemId: string,                  // ap_map_system.id as string
  rows: ParsedSigRow[],                 // incl. classKind; server re-resolves, preview-only resolution dropped
  options: {
    addMissing: boolean,
    updateExisting: boolean,
    removeMissing: boolean,
    removeOrphanedConnections: boolean,
  },
}
```

**Auth & guards:** `requireMapMutate(rawMapId, session, 'map_update')` — 401 / 403 / 404.

**Behaviour:** Re-resolves `rows` via `resolveSignatureRows` (authoritative source — preview is best-effort), then dispatches `pasteSignatures` with `defaultExpiresAt = now + SIGNATURE_DEFAULT_TTL_MS`. The orchestrator commits all events under one transaction.

**Returns:** `ActionResult<BulkPasteResult>`. On success: `{ ok: true, data: { summary, payloads }, eventId: 0 }` — consumers iterate `payloads` for per-event `eventId`s (the wrapper's `eventId` is `0` because bulk is N-events). On failure: `{ ok: false, error }` with HTTP 400.

**Limits:** `rows.max(500)` — paste limit; a real probe-scan tops out around 30 sigs, 500 is comfortable headroom plus a DoS guard.
