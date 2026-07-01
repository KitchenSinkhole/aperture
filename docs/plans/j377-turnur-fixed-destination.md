# J377 → Turnur: fixed-destination wormholes

**Goal:** Teach Aperture that a J377 wormhole always exits to **Turnur** (a specific named system), so marking a signature/connection as J377 can resolve and place the Turnur destination node — instead of only knowing "leads to lowsec" as PR #175 gives us today.

**References:**
- PR #175 — adds `J377;;L` to `scripts/data/wormhole-classes.csv` (class-only: `target_class = L`, source unspecified). This plan builds on top of it.
- `src/db/schema/universe/statics.md` — `universe_wormhole` catalog ("Class-only catalog" note is the thing we're extending).
- `src/lib/sde/ingest.md` — CSV ingest path (`runCsvIngest`, `wormhole-classes.csv` reseed).
- `src/lib/eve/wormholeJumpInfo.md`, `src/lib/map/wormholeTypes.md` — catalog read paths.
- `src/lib/map/thera.md` + `src/app/api/map/[mapId]/thera/sync/route.md` — **existing** "ensure hub + target system visible, ensure a `wh` connection, idempotently, in one transaction, emit map events" machinery to reuse.
- CLAUDE.md — mutation pathways (user action → Server Action/API → one `ap_map_event` → `pg_notify` → WS), `universe_*` fixes via ingest not migrations, hand-written migrations since 0011, no `active` booleans, companion `.md` standing instruction.

**Background facts (load-bearing):**
- J377 is the first wormhole type whose destination is a *specific system*, not just a security class. Turnur = `universe_system.id` **30002086** (lowsec, Metropolis) — confirm against `universe_system` during Stage 1, don't hard-code blindly.
- The guarantee is **one-directional**: seeing J377 ⇒ far end is Turnur. The reverse hole *in* Turnur is a plain **K162** (source/target both null). Never infer a destination from the Turnur side.
- `target_class = 'L'` stays true and correct — the system-level fact is a refinement layered on top, not a replacement. Existing class-based "mark as static" matching is untouched.
- **Relationship to EVE-Scout:** the Thera module already lists *currently scouted* Turnur connections and can sync them (`syncTheraConnections`). That's a live public feed of holes someone already scanned. This feature is complementary: it lets a user who scans their *own* J377 resolve Turnur even when EVE-Scout hasn't published that particular hole. Same destination, different source of truth — and they should converge on the same Turnur node via the idempotent ensure-node path.

---

## Stage 1 — Fixed-destination column + catalog data

**Mode:** Plan mode
**Goal:** Give `universe_wormhole` a place to record "this hole always exits to system X", and seed J377 → Turnur through the ingest path.

**Touches:**
- `src/db/migrations/0048_wormhole_target_system.sql` + `.rollback.sql` + `meta/_journal.json` (hand-written; latest is 0047).
- `src/db/schema/universe/statics.ts` + `statics.md`, `src/db/schema.md`.
- `scripts/data/wormhole-classes.csv` (extend to `code;sourceClasses;targetClass;targetSystem`, only J377 populated) **or** a small separate vendored override file — decide in plan mode.
- `src/lib/sde/ingest.ts` + `ingest.md` (`runCsvIngest` / the `wormhole-classes.csv` reader resolves the destination system id; FK-safe against `universe_system`).

**Details:**
- Add nullable `target_system_id` `integer` FK → `universe_system.id` `ON DELETE RESTRICT` on `universe_wormhole`. NULL for every normal hole (destination genuinely unknown until scanned); set only for fixed-destination holes.
- The *column* is a schema change (migration). The *value* is `universe_*` data, so it rides the vendored CSV consumed by ingest, per the "data fixes via ingest, not migrations" rule — the migration ships an empty column, ingest fills J377.
- Reseed remains authoritative (full delete + insert), so the new column must be written on every reseed, not patched in.

**Done when:** migration applies cleanly (and rolls back); `pnpm sde:csv` populates J377's `target_system_id` with Turnur's id and leaves all other rows NULL; a spot query confirms it; lint + typecheck + build green.

---

## Stage 2 — Surface the destination on the read paths

**Mode:** Accept edits
**Goal:** Carry the resolved destination (id + name + security class) through the two catalog read paths so the UI can show "Leads to: Turnur".

**Touches:**
- `src/lib/eve/wormholeJumpInfo.ts` + `.md` — add `targetSystemId` / `targetSystemName` to `WormholeJumpInfoRow` (left-join `universe_system`).
- `src/lib/map/wormholeTypes.ts` + `.md` — add the same to `WormholeTypeOption` so the dropdown option knows its fixed destination.
- `src/types/index.ts` — update the two re-exported result shapes.
- The Jump Info dialog component + its `.md` — render the destination line when present.
- `src/app/api/map/[mapId]/wormhole-types/route.md` — note the new field.

**Details:** Purely additive; rows with NULL `target_system_id` render exactly as before (just the class label). No behavioral change to suggestion filtering — J377 already shows everywhere via `source_classes IS NULL`.

**Done when:** the Jump Info dialog shows Turnur as J377's destination; `WormholeTypeOption` carries the destination for J377 and `null` for everything else; build green.

---

## Stage 3 — Resolve the destination onto the map

**Mode:** Plan mode
**Goal:** When a signature is identified as a fixed-destination hole (J377), let the user resolve its far end to the known system (Turnur) — placing the node and the `wh` connection — without scanning the other side.

**Touches (anticipated — confirm in plan mode):**
- `src/lib/map/thera.ts` — factor the per-pair core ("ensure source + target `ap_map_system` visible, ensure one `wh` connection, idempotent in either direction, emit events") out of `syncTheraConnections` into a shared helper both call. Justified reuse, not speculative refactor.
- A mutation entry point that, given a linked-or-unlinked J377 signature, ensures the Turnur node + a `wh` connection from the sig's system to Turnur — through the existing pathway (Server Action / API route → map events → `pg_notify` → WS), one `ap_map_event` per change.
- The signature inspector UI + `.md` — surface a "resolve destination" affordance when the selected `typeId` has a non-null `target_system_id` (mirror the Thera module's `+` add button).

**Open design decisions for plan mode:**
- **Explicit vs. automatic:** a one-click "resolve to Turnur" button (mirrors Thera's add UX, no surprise mutations) vs. auto-creating the connection the moment the type is set. Lean explicit; decide here.
- **Dedupe:** Turnur is k-space and may already be on the map (via gate, EVE-Scout sync, or another J377). Respect the `(map_id, system_id)` unique constraint and the existing-connection-in-either-direction skip, exactly like `syncTheraConnections`.
- **One-directional guarantee:** only the J377 side resolves; never infer anything from a K162 in Turnur.
- **Multiple simultaneous J377s** converging on one Turnur node — already supported by the map model (many connections, one node); just don't duplicate the node.

**Done when:** identifying a J377 in a system with no far side places Turnur + a `wh` connection via one click; repeating it is a no-op (no duplicate node/connection); the change rides one map event per write and broadcasts over WS; existing Thera sync behavior is unchanged; build green + a focused test on the ensure-node/ensure-connection idempotency.

---

## Notes for whoever picks this up

- Start a **fresh session per stage** (per CLAUDE.md planning convention). Open this file, read the stage, enter the mode it names (`Shift+Tab` toggles Plan ⇄ Accept-edits), and execute just that stage.
- Stages 1 and 2 are independently shippable and harmless on their own (data + display only). Stage 3 is where behavior changes — keep it gated behind the explicit affordance so a half-done Stage 3 never auto-mutates maps.
- Don't widen scope to "any fixed-destination hole framework" beyond what J377 needs — `target_system_id` already *is* the general mechanism; J377 is simply its first row. Future Turnur-style holes slot in as data with no further schema work.
