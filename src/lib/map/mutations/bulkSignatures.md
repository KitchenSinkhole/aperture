## bulkSignatures.ts

**Purpose:** Atomic signature-paste orchestrator. Diffs incoming resolved rows against a system's existing sigs and loops the per-sig helpers (and optional `deleteConnection`) under one outer transaction.
**File:** `src/lib/map/mutations/bulkSignatures.ts`

---

### pasteSignatures(input: PasteSignaturesInput): Promise<ActionResult<BulkPasteResult>>
Opens a single `db.transaction()`, loads the system's current `apMapSignature` rows, and **first sweeps expired ghosts**: any row whose `expiresAt <= now()` is `deleteSignature`'d up front (the reap cron is only a lazy GC, so within its lag window an expired row still occupies its `(map_system_id, sig_id)` slot). The sweep is independent of `removeMissing`, is **not counted** in the summary (it's housekeeping, not a paste decision), but its `signature.delete` events still ride `payloads` so every tab drops the ghost. Freeing the slot means a re-pasted code that collided only with a dead row becomes a clean **create**, not an "update" of an invisible row. The diff then partitions the remaining **live** rows by `sigId` against the incoming `ResolvedSigRow[]` and dispatches each diff item:

- **Incoming only** + `addMissing` → `createSignature` (with `expiresAt = input.defaultExpiresAt`, `name = null`, `description = null`).
- **Both** + `updateExisting` → `updateSignature` (only **live** rows reach this branch — expired ones were swept above). The patch **always** sets `expiresAt = input.defaultExpiresAt` — a sig re-appearing in a fresh scan is still in space, so every paste resets its TTL and keeps an actively scanned sig from decaying out from under viewers. On top of that: differing non-null `groupKey`/`typeId` are patched (incoming nulls never clobber prior classification); `classKind` is patched whenever it differs (the parser always resolves a kind, so a fresh paste fills a previously-null row or corrects a stale one); and `name` is patched only when the incoming row has a name **and** the existing `name` is blank — this fills the Type cell for a row first added from a low-strength scan (group known, site name not yet revealed) without clobbering a user-typed/previously-resolved name. Because `expiresAt` is always present, `updateSignature` always runs for every matched sig (also refreshing `updatedAt` / "last seen").
- **Existing only** + `removeMissing` → `deleteSignature`. If the sig had `mapConnectionId IS NOT NULL` and `removeOrphanedConnections` is on, also `deleteConnection` for that edge.

Each helper call forwards `tx`, so every event row + side-effect insert/update runs on the same transaction. On any helper returning `{ ok: false }`, throws to abort the transaction — partial writes are impossible. On success, the `tg_map_event_notify` trigger fires once per inserted event row *after* commit, fanning N realtime envelopes to every subscribed tab.

**Parameters:**
- `input.mapId` / `input.mapSystemId` / `input.characterId` — standard mutation context.
- `input.rows` — `ResolvedSigRow[]` from `resolveSignatureRows` (the route handler resolves authoritatively, the dialog preview is best-effort).
- `input.options` — `BulkPasteOptions` (the four flags from the dialog).
- `input.defaultExpiresAt` — `Date` for new sigs' `expiresAt`. Caller supplies so the constant lives in `aperture.config.ts` only.

**Returns:** `ActionResult<BulkPasteResult>` where `data` is `{ summary, payloads }`. `summary` counts each *paste-decision* action (added/updated/removed/connectionsRemoved) — expired-ghost sweeps are excluded, so `payloads.length` can exceed the summed counts. `payloads` is the full committed `MapEventPayload[]` in commit order (ghost `signature.delete`s first, then the diff). The wrapping `ActionResult.eventId` is set to `0` — the bulk path is N-events, so consumers should iterate `data.payloads` for per-event `eventId`s.

---

### Types
- `BulkPasteOptions = { addMissing, updateExisting, removeMissing, removeOrphanedConnections }` — all `boolean`.
- `BulkPasteSummary = { added, updated, removed, connectionsRemoved }` — all `number`.
- `BulkPasteResult = { summary, payloads }`.
- `PasteSignaturesInput` — the argument bag (bigints for ids, `Date` for `defaultExpiresAt`).

All re-exported from `src/types/index.ts`.

### Depends On
- `createSignature` / `updateSignature` / `deleteSignature` (`./signatures`) — joined via `tx`.
- `deleteConnection` (`./connections`) — joined via `tx` when tearing down orphan WH edges.
- `commitMapEvent` is indirectly the commit primitive (one per affected sig).
