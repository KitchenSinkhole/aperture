## signatures.ts

**Purpose:** Signature CRUD mutation helpers — each is exactly one `commitMapEvent` call.
**File:** `src/lib/map/mutations/signatures.ts`

---

### createSignature(input: CreateSignatureInput): Promise<ActionResult<MapEventPayload>>
Inserts an `ap_map_signature` row and emits `signature.create` with the full body (all columns the canvas needs, including `createdAt`/`updatedAt`, plus the `leadsToMapSystemId` audit descriptor — the far endpoint of the linked connection when the sig is created already linked, else null). Does not validate that `mapSystemId` belongs to `mapId` at this layer — the calling route handler is expected to have already confirmed map ownership.

**Parameters:**
- `input.mapId` — the owning map (for the event row).
- `input.mapSystemId` — `ap_map_system.id` (the system the sig is in).
- `input.mapConnectionId` — optional FK to the resolved wormhole connection.
- `input.sigId` — in-game 3-char scan id (e.g. `"ABC"`).
- `input.expiresAt` — when the sig ages out (set by the caller, typically now + 24 h).
- `input.tx` *(optional)* — outer Drizzle transaction (see `bulkSignatures.ts`). Forwarded to `commitMapEvent`.
- remaining fields — `groupId`, `typeId`, `name`, `description` (all optional).

---

### updateSignature(input: UpdateSignatureInput): Promise<ActionResult<MapEventPayload>>
Patches only the keys present in `input.patch`. Validates ownership by joining through `apMapSystem.mapId` before the update — throws `"Signature does not belong to this map."` if mismatched. Emits `signature.update` with the changed fields plus `id`, `updatedAt`, and the audit descriptors `mapSystemId` (owning system) and `sigId` (the resulting in-game code — the edited value when the code changed, else the unchanged current one, so the history entry always names *which* signature). When the `mapConnectionId` link changes it also emits `leadsToMapSystemId` — the far endpoint of the new connection when linking, or of the prior connection (still alive at update time) when unlinking — so the trail can name what the sig leads to / was unlinked from. Accepts optional `input.tx` for joined-batch commits.

The event also carries a `snapshot` — the **full post-update row** (every `signatureBody` field, including `leadsToMapSystemId` resolved for any still-linked sig) — so a client whose baseline for this sig is missing/wrong (reconnect gap, missed `signature.create`, reordering) can upsert the whole row instead of silently no-op'ing the merge-by-id. The snapshot's `leadsToMapSystemId` lets the Stage 4 restore offer name a dormant connection's destination even on a paste that doesn't change the link. It is purely **additive**: the conditional audit fields and Discord/audit no-op suppression read only the changed-key fields and ignore `snapshot`, so precision is untouched. Marginal cost is one `universe_wormhole` lookup whenever the post-update row has a non-null `typeId` (resolved once, reused by both the `wormholeCode` audit field and the snapshot).

Internal helper `resolveLeadsTo(tx, connectionId, sigMapSystemId)` returns the connection's far endpoint (`ap_map_system` id, stringified) relative to the sig's own system, or null when the connection is gone.

---

### deleteSignature(input: DeleteSignatureInput): Promise<ActionResult<MapEventPayload>>
Hard-deletes the signature row. Validates ownership through `apMapSystem.mapId` (same check as `updateSignature`). Emits `signature.delete` → `{ id, mapSystemId, sigId }` — the owning system id and in-game code are captured before the delete so the audit/Discord name the removed sig (the row is gone afterwards). Accepts optional `input.tx`.

---

### Types
- `CreateSignatureInput` — full create payload.
- `UpdateSignaturePatch` — all fields optional; only present keys are written.
- `UpdateSignatureInput` — wraps `signatureId`, `mapId`, `characterId`, `patch`.
- `DeleteSignatureInput` — `mapId`, `signatureId`, `characterId`.
