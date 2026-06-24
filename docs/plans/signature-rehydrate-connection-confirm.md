# Signature re-hydration, full-body update upsert, connection confirmation state, and sig-memory restore

## Context

Testing uncovered two reproducible bugs, both rooted in the same mechanism. `removeSystem`
is a **soft delete** — it flips `ap_map_system.visible = false`; the row and everything hanging
off it (signatures, connections) survive in the DB because `ON DELETE CASCADE` only fires on a
real row DELETE, never on an UPDATE.

- **Bug 1 (signatures):** Re-adding a soft-removed system emits `system.added` carrying only the
  node body. The surviving `ap_map_signature` rows are never re-emitted, so the panel shows empty
  until a full page reload (`loadMapForView`) re-hydrates from the DB. Re-pasting doesn't help:
  the rows still exist, so `pasteSignatures` takes the UPDATE path (`"0 added, 16 updated"`), and
  the client's `signature.update` reducer merges *by id* — a silent no-op when the client doesn't
  already hold the row.
- **Bug 2 (connections):** The orphan connection row survives the soft-delete. Re-adding the
  system emits no connection event, so the edge is missing until reload — where `loadMapForView`'s
  "both endpoints visible" query resurrects an **unconfirmed** connection that nobody re-scanned.

Guiding principle: a wormhole connection is only as valid as a current sig observation. It must
**not** auto-restore on a bare re-add; restoration is gated on a fresh paste of the sig. To make
*reload* respect that (not just the live client), a connection needs an explicit
"confirmed by a current observation" state — chosen model: **`confirmed_at` on the connection**
(see Stage 3 + the convention-deviation note).

Staging: Stages 1–2 fix Bug 1 (signatures). Stage 3 fixes Bug 2's reload-reappearance and is the
foundation for Stage 4. Stage 4 is the sig-memory restore feature.

**References:** `src/lib/map/mutations/systems.ts`, `signatures.ts`, `bulkSignatures.ts`,
`connections.ts`, `core.ts`; `src/lib/map/loadMap.ts`; `src/lib/map/applyEvent.ts`;
`src/lib/realtime/protocol.ts`; `src/lib/webhooks/formatters.ts`; `src/components/map/MapCanvas.tsx`,
`SubchainDeletePrompt.tsx`; `src/db/schema/ap/map_connection.ts`. CLAUDE.md (mutation pathways,
one event per mutation, lifecycle rules, companion `.md` standing instruction); memory:
"Audit log must be precise & intent-level", "Migrations hand-written since 0011".

---

## Stage 1 — Re-add re-hydration (signatures ride on `system.added`)
**Mode:** Accept edits
**Goal:** Re-adding a soft-removed system shows its surviving signatures immediately on every tab,
no reload — fixing Bug 1.

**Approach:** Embed the system's current signatures in the `system.added` payload rather than
emitting separate fake events. This rides the single real broadcast event (so *all* tabs
re-hydrate, not just the initiator) and adds no `ap_map_event` history noise. Connections are
**not** embedded.

**Touches:**
- `src/lib/map/mutations/systems.ts` — in `buildSystemNode(tx, id)` (the node-body builder both
  `addSystem` and the orchestrator use), also load the system's `ap_map_signature` rows
  (LEFT JOIN `universe_wormhole` for `wormholeCode`, mirroring the signature load in
  `loadMapForView`) and attach them as `signatures: MapSignature[]` on the `system.added` body.
  Brand-new systems naturally return `[]`.
- `src/lib/realtime/protocol.ts` — extend the `system.added` variant with an optional `signatures`
  array (reuse the existing `signatureBody` shape).
- `src/lib/map/applyEvent.ts` — in `system.added`, after upserting the node, **upsert** each entry
  of `payload.signatures` into `state.signatures` (find-by-id replace, else append — the existing
  `signature.create` pattern). Upsert, not replace-all; `system.removed` already pruned this
  system's sigs.
- Companion `.md` updates: `systems.md`, `protocol.md`, `applyEvent.md`.

**Reuse:** `buildSystemNode` (single chokepoint → covers route adds, location poll, import, Thera);
the `signatureBody` Zod object; the `loadMapForView` signature-load join; the `signature.create`
upsert reducer.

**Done when:** add system → paste sigs → delete → re-add same system → sigs appear immediately
(no refresh) on both the initiating tab and a second tab; a brand-new add carries no stale sigs.

---

## Stage 2 — Full-body upsert on `signature.update` (resilience)
**Mode:** Accept edits
**Goal:** A `signature.update` self-heals a client whose baseline is missing/wrong (reconnect gaps,
missed `signature.create`, reordering) instead of silently no-op'ing — **without** regressing
audit/Discord precision.

**Key constraint:** `describeMapEvent` (`formatters.ts`) enumerates changed fields by *which keys
are present* and returns `null` to suppress no-op updates (e.g. the pure `updatedAt` "last seen"
bump on every pasted sig). The full snapshot must not disturb those fields.

**Approach — snapshot-additive:** Keep today's conditional changed-fields + descriptors on the
payload exactly as-is (formatter and audit keep reading them — precision and no-op suppression
untouched), and **add** a `snapshot` object with the full post-update row. The client upserts from
`snapshot`; the formatter ignores it. (Rejected: replace fields with full body + `changedKeys[]` —
higher risk, requires rewriting `describeSignatureChanges`'s housekeeping-suppression logic.)

**Touches:**
- `src/lib/map/mutations/signatures.ts` — `updateSignature`: widen the `UPDATE … RETURNING` to the
  full row, resolve `wormholeCode` + `createdAt`, attach `snapshot` (full `signatureBody`) alongside
  today's fields. Marginal cost is one `wormholeCode` lookup only when `typeId` is non-null.
- `src/lib/realtime/protocol.ts` — add optional `snapshot: signatureBody` to `signature.update`.
- `src/lib/map/applyEvent.ts` — `signature.update`: if `payload.snapshot` present, upsert it
  (replace-by-id, else append); else fall back to today's merge-by-id.
- Companion `.md` updates: `signatures.md`, `protocol.md`, `applyEvent.md`.

**Reuse:** `signatureBody`; the `signature.create` upsert reducer; `resolveWormholeCode` /
`resolveLeadsTo`.

**Note:** Stage 1 already fixes Bug 1; Stage 2 is defensive hardening. Signatures only —
`connection.update` / `system.updated` deferred.

**Done when:** a tab that never received a sig's `create` materializes it on the next
`signature.update`; a single-field edit still names only that field in audit + Discord; a paste's
`updatedAt`-only bumps still produce no audit/Discord line.

---

## Stage 3 — Connection confirmation state (`confirmed_at`) — fixes reload reappearance
**Mode:** Plan mode
**Goal:** Unconfirmed wormhole connections never reappear on reload. A connection is shown (live
and on reload) only while it is confirmed by a current observation; removing a system makes its
`wh` connections *dormant* (kept as memory, hidden), and only a fresh sig paste re-confirms.

**Convention deviation (recorded per CLAUDE.md):** CLAUDE.md says "hard-delete for
`ap_map_connection`" and "no generic active boolean." We add `confirmed_at timestamptz` (a
meaningful timestamp like `last_visible_at`/`deleted_at`, **not** a boolean) and treat
*system-removal* of a `wh` connection as dormancy rather than deletion — so the observed WH
type/mass/EOL/static state is preserved for an in-place restore. **Genuine collapse**
(`deleteConnection`) still hard-deletes and cascades the sig; the deviation is narrow and limited to
the endpoint-removal path. Dormancy applies to `wh` scope only — `stargate`/`jumpbridge`/`abyssal`
are structural, never sig-confirmed, and reappear automatically when both endpoints are visible.

**Touches:**
- **Migration `0042_connection_confirmed_at`** (hand-written `.sql` + `.rollback.sql` + journal
  entry; apply before tests — memory rule): add nullable `confirmed_at timestamptz` to
  `ap_map_connection`; **backfill existing rows `confirmed_at = created_at`** so nothing vanishes on
  deploy.
- `src/db/schema/ap/map_connection.ts` (+ `.md`) — add the `confirmedAt` column.
- `src/lib/map/mutations/connections.ts` — `createConnection` sets `confirmed_at = now()` (fresh
  assertion) for every new connection (manual draw, sig link, stargate auto-link).
- `src/lib/map/mutations/systems.ts` — `removeSystem`: inside its transaction, after flipping the
  system invisible, `UPDATE` incident **`wh`** connections `SET confirmed_at = NULL`. No new event
  kind — the existing `system.removed` already drives every client to prune incident connections, so
  live + reload now agree (reload no longer resurfaces them).
- `src/lib/map/loadMap.ts` — `loadMapForView`: add `AND confirmed_at IS NOT NULL` to the connection
  load (on top of the existing both-endpoints-visible filter). Non-`wh` rows always have a non-null
  `confirmed_at`, so they're unaffected.
- Companion `.md` updates for each.

**No client-side `confirmed_at` logic:** dormant connections are simply never sent to the client
(loadMap filters them; nothing broadcasts them). `applyEvent` and `MapConnectionEdge` need no
`confirmedAt` field.

**Reuse:** existing `system.removed` client pruning; the `loadMapForView` connection query; the
`createConnection` commit path.

**Done when:** add A+B (wh) → connect → remove B → re-add B → the edge does **not** appear, and a
page reload **does not** resurrect it; a normal connection between two present systems still loads
on reload; stargate links between re-added k-space systems still appear.

---

## Stage 4 — Sig-memory connection restore (new feature)
**Mode:** Plan mode
**Goal:** When a paste re-confirms a wormhole sig whose remembered connection is currently dormant,
offer (non-blocking) to restore it — re-confirming the connection and re-activating the far system.

**Why no schema change beyond Stage 3:** the dormant connection row (full WH type/mass/EOL/static)
and the soft-deleted far-system row both persist, and the re-confirmed WH sig still carries
`map_connection_id →` that dormant connection. Restore = flip `confirmed_at = now()` + re-activate
the far system + re-broadcast the connection. We never delete/recreate it (that would cascade the
sig and lose the observed state).

**Detection (client, post-paste):** Mirror the existing `onLazyDeletePasteResult` hook in
`MapCanvas.tsx` (~L943). After `applySignaturePaste` returns committed payloads, scan for wh
sigs (`groupKey === 'wormhole'`) that carry a `mapConnectionId` / `leadsToMapSystemId` but whose
connection is **absent from `viewData.connections`** (absent ⇒ dormant/hidden). Each becomes a
restore offer; multiple WH sigs in one paste → multiple offers (explicitly required).

**Prompt (non-blocking, queued):** Reuse the `SubchainDeletePrompt.tsx` pattern (pinned shadcn
`Card`, dismiss-X + confirm, UI stays interactive) and the `subchainSigPrompts` queue in
`MapCanvas.tsx`. One offer per remembered connection, e.g. "Restore connection to **J165748**?",
confirm/dismiss each independently.

**Restore mutation (server):** New mutation + route (e.g.
`POST /api/map/[mapId]/connections/[connId]/restore`, gated by `requireMapMutate('map_update')`).
In one `db.transaction`, fold payloads like `addSystemWithStargateLinks`:
1. `addSystem({ systemId: farSystem, tx })` — re-activates the far system if invisible (idempotent
   if already visible); rides Stage 1 so its surviving sigs come along → `system.added`.
2. `commitMapEvent({ kind: 'connection.create', tx, mutate })` where `mutate` sets the existing
   connection's `confirmed_at = now()` and returns its full edge body → `connection.create`
   (idempotent upsert on the client).
Return `{ payloads }`; client folds via `onBulkPaste`.

**Bounds & open notes (resolve in plan mode):**
- Memory window is implicitly the sig's lifetime: once `signatureReap` deletes the expired sig, a
  re-paste creates a fresh unlinked sig → no offer. ~24h is acceptable for v1; can tighten to WH max
  lifetime later.
- Confirm the sig-id persistence assumption (cosmic sig IDs are stable for a signature's lifetime
  across downtime) before building.
- Resolve the far endpoint's EVE `systemId` (for `addSystem`) from the dormant connection's far
  `ap_map_system` row.
- Orphan-connection hygiene: a dormant connection whose sig later reaps and whose far system never
  returns lingers hidden — a future reaper concern, out of scope here.

**Done when:** map J123123 with wh sig `ABC → J456` → roll off (remove) → re-add J123123 → paste
sigs incl. `ABC` (wormhole) → a non-blocking prompt offers to restore the connection to J456 →
confirm re-activates J456 and re-confirms the edge with its preserved WH type/mass/EOL, live and
reload-consistent; dismiss leaves the map unchanged; multiple remembered wh sigs queue multiple
prompts.

---

## Verification

- **Manual (primary):** reproduce both original reports end-to-end with two tabs open (initiator +
  observer) to confirm convergence without reload. For Stage 3, explicitly reload after re-add and
  confirm the wh edge stays gone. Walk the Stage 4 "Done when" scenario.
- **Integration tests** (`RUN_DB_TESTS=1`, hits live dev `aperture-db-1` — snapshot/restore global
  rows): extend `tests/integration/map-signature-paste.test.ts` for re-add → re-hydrate; assert
  `system.added` carries surviving sigs. Stage 3: extend
  `tests/integration/map-system-connection-mutations.test.ts` — removing a system dormants its wh
  connections; `loadMapForView` omits dormant edges; stargate links unaffected. Stage 4: a
  re-confirming paste produces a restore offer and the restore mutation flips `confirmed_at` +
  re-activates the far system without inserting a duplicate connection row.
- **Unit:** extend reducer tests for `system.added`-with-signatures and `signature.update`-snapshot
  upsert (`tests/unit/apply-signature-paste.test.ts` / `applyEvent`). Audit precision (Stage 2):
  single-field edit renders only that field; `updatedAt`-only bump returns `null`.
- **CI gate:** run the `ci-verifier` agent (`pnpm lint`, `pnpm typecheck`, `pnpm build`) after each
  stage; apply the migration before running DB tests.
