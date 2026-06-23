## formatters.ts

**Purpose:** Pure functions that turn a `MapEventPayload` + a pre-resolved naming context into a Discord webhook payload (and the shared one-line audit description). No DB access — the caller owns the joins.
**File:** `src/lib/webhooks/formatters.ts`

---

### describeMapEvent(event, ctx): string | null
The single human-readable description of a map event — **the action only, with no leading actor** (`"set **Jita** status to \`friendly\`"`, no trailing period). Shared by `formatHistoryMessage` (Discord, which prepends the acting character + a period) and the in-map audit console (`src/lib/map/audit.ts`, which has its own actor column and sentence-cases the phrase) so both surfaces phrase a commit identically without duplicating the name. Returns `null` when the event has nothing worth saying — a position-only `system.updated` (a canvas drag) **or** an `*.update` whose only fields are unrecognized/descriptor-only — which both callers drop. Does not handle `map.restore` / `map.purge` (returns `null`); the audit layer supplies its own fallback.

`*.update` lines **enumerate every changed field** as a `field → value` clause list in parentheses, so the trail shows exactly what changed rather than "made a change": `connection.update` → `"updated **A** ↔ **B** (max ship size → large, mass → \`critical\`)"` (covers `scope`/`massStatus`/`jumpMassClass`/`eolStage`/`isRolling`/`preserveMass`/`isStatic`; `jumpMassClass` maps `s`/`m`/`l`/`xl` → small/medium/large/x-large via `JUMP_MASS_LABEL`); `signature.update` → `"updated signature \`AUQ\` in **Jita** (type → \`B274\`)"`. `describeSignatureChanges` **suppresses the housekeeping field-resets** the client folds into a primary edit — picking a WH type clears `name` (the code-mirror), and changing the group clears `typeId`+`name` — so the line reports intent, not noise. A `mapConnectionId` change reads `"leads to **<dest>**"` / `"unlinked from **<dest>**"`, where `<dest>` is `ctx.targetSystemName` (resolved from the payload's `leadsToMapSystemId`). `sigId`/`mapSystemId` are descriptor-only and never counted as changes. `describeSignatureCreate` summarizes a new sig as `"(wormhole \`C008\`, leads to **<dest>**)"` (WH) or `"(relic site)"` (cosmic) via `signatureClassification`. Destructive lines name their target from descriptors embedded in the payload: `connection.delete` reads `ctx.sourceSystemName`/`targetSystemName`, `signature.delete` reads `event.sigId` + `ctx.systemName`. Pre-fix historical events lacking the descriptors fall back to generic placeholders.

**Map notes** are named directly from the payload (no `ctx` lookup — the title rides every note event): `note.created` → `"added note **<title>**"` (plus `(\`severity\`)` when non-neutral); `note.deleted` → `"removed note **<title>**"`; `note.updated` reports the single primary change — severity (`"changed note **<title>** severity to \`red\`"`), lock (`"locked/unlocked note **<title>**"`), body (`"updated/cleared the body of note **<title>**"`), else a title-only edit (`"renamed note to **<title>**"`). A pure position drag (`positionX`/`positionY` only) returns `null` like a system drag.

**Parameters:**
- `event` — the validated `MapEventPayload`.
- `ctx` — pre-resolved `WebhookEventContext` names.
- `who` — acting character name; callers pass `ctx.characterName ?? 'Aperture'`.

---

### isRallySetEvent(event: MapEventPayload): boolean
Returns true when `event.kind === 'system.updated'` AND `event.rallyAt` is a non-empty string. Used by the dispatcher to decide whether to fan a `system.updated` event out to `event='rally'` webhooks in addition to the always-on `history` fanout.

---

### formatHistoryMessage(event, ctx, mapName?): DiscordWebhookPayload | null
Build a Discord payload (single-line `content`) describing the event for a `history` webhook. Composes `**<map>** — <who> <action>.` from `describeMapEvent` (which omits the actor) — `<who>` is `ctx.characterName ?? 'Aperture'`. Returns `null` for events that are nothing but cosmetic position updates / no-op updates (skip silently).

**Parameters:**
- `event` — the `ap_map_event.payload` validated against `mapEventPayloadSchema`.
- `ctx` — pre-resolved names (`mapName`, `characterName`, `systemName`, `sourceSystemName`, `targetSystemName`).
- `mapName` — defaults to `ctx.mapName`; override only for special cases.

**Returns:** `{ content: '**<map>** — <who> added **<system>** to the map.' }` shape.

---

### formatRallyMessage(event, ctx): DiscordWebhookPayload | null
Build a Discord embed payload for a `rally` webhook. Returns `null` if the event is not a rally-set event (defensive — callers should check `isRallySetEvent` first).

The embed is red (`0xE74C3C`), titled `"Rally point set in <system>"`, and timestamped with the event's `rallyAt` ISO string.

---

### Types

- `WebhookEventContext` — `{ mapName, characterName, systemName, sourceSystemName, targetSystemName }`. Every name field is `string | null`; the dispatcher fills what it can resolve and the formatter falls back to generic placeholders ("a system", "Aperture", …) for missing pieces. For connection events `source`/`targetSystemName` are the two endpoints; for signature events `systemName` is the sig's own system and `targetSystemName` doubles as the sig's leads-to destination (resolved from `leadsToMapSystemId`).
