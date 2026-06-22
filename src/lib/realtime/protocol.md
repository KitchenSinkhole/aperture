## protocol.ts

**Purpose:** Zod wire contracts for the realtime WebSocket transport — the `{task, load}` envelope and the fixed task vocabulary as direction-split discriminated unions.
**File:** `src/lib/realtime/protocol.ts`

The WS is broadcast-only: server fans `pg_notify('map:'||map_id,…)` events to subscribed sockets; clients only send `subscribe`/`unsubscribe`. Authorization is session-based (Auth.js) — no on-wire token handshake. Control-plane shapes are firm. The `mapUpdate` body is the tightened map-event payload; the remaining data-bearing bodies stay forward-declared (`data: z.unknown()`).

---

### Constants

- `SERVER_TO_CLIENT_TASKS` — `['mapUpdate','mapAccess','mapConnectionAccess','mapDeleted','characterUpdate','characterLogout','healthCheck','logData','systemNotification','connectionMassLog']`.
- `CLIENT_TO_SERVER_TASKS` — `['subscribe','unsubscribe']`.

### Types
- `ServerToClientTask` / `ClientToServerTask` — string-literal unions of the above.
- `Envelope` — `{ task, load: unknown }`.
- `ServerToClientMessage` / `ClientToServerMessage` — inferred from the discriminated unions; re-exported from `src/types/index.ts`.
- `MapEventPayload` — inferred from `mapEventPayloadSchema`; the realtime `mapUpdate.load.data` body and the jsonb `ap_map_event.payload`.
- `MapEventKind` — the 14 seeded `ap_event_kind` values (also `MAP_EVENT_KINDS` const tuple). Includes `map.restore` and `map.purge` for the admin maps panel (migration 0014).
- `MapEventPatch<K>` — the payload for kind `K` minus `kind`/`eventId`; the body a mutation's `mutate()` returns.

### Schemas

- `envelopeSchema` — raw frame `{ task: <any task>, load: unknown }`. Use to peek at `task` before per-task validation.
- Control-plane loads (firm): `subscribeLoadSchema` / `unsubscribeLoadSchema` (`{ mapIds: number[] }`), `healthCheckLoadSchema` (`{ ts, ok?, listeners? }`), `mapDeletedLoadSchema` (`{ mapId }`), `characterLogoutLoadSchema` (`{ characterIds }`), `mapAccessLoadSchema` (`{ mapId, characterIds }`).
- `mapEventPayloadSchema` — `z.discriminatedUnion('kind', …)` over the 14 event kinds. Every variant is `{ kind, eventId, ...patch }`: `system.added`/`connection.create`/`signature.create`/`map.create` carry the full body (system body mirrors `MapSystemNode` including `intelNotes`, `rallyAt` and `tradeHub` (`{ name, jumps } | null`), plus an optional `signatures: signatureBody[]` re-hydrating a re-added system's surviving sigs on every tab — see `buildSystemNode`/`applyEvent`, absent/empty for a brand-new add; edge mirrors `MapConnectionEdge` including `isStatic`/`eolAt`/`createdAt`; signature body includes `createdAt`/`updatedAt` so the panel can display timestamps); `*.updated`/`*.update` carry `{ id, ...partial }` (`signature.update` includes `updatedAt`); `system.removed`/`map.delete`/`map.restore`/`map.purge` carry `{ id }` (`connection.delete` / `signature.delete` carry extra audit descriptors — see below). Timestamps (`rallyAt`, `eolAt`, `createdAt`, `updatedAt`, `expiresAt`, `deletedAt`) are ISO strings. `map.purge` is emitted *inside* the purge transaction before the `ap_map` DELETE; pg_notify buffers the message until COMMIT, so subscribers receive it even though the source `ap_map_event` row is cascaded out.
  - **Audit descriptors on hard-deleting / update kinds.** Because `ap_map_connection` and `ap_map_signature` rows are hard-deleted, their `*.delete`/`*.update` events embed optional, self-describing context captured at mutation time so the history feed (`audit.ts`) and Discord (`dispatcher.ts`) never need to join a now-gone row: `connection.delete`/`connection.update` carry `source`/`target` (endpoint `ap_map_system` ids); `signature.delete` carries `mapSystemId`/`sigId`; `signature.update` carries `mapSystemId` plus the resulting `sigId` (so it names *which* sig even when the code wasn't the edited field). `signature.create` and `signature.update` also carry `leadsToMapSystemId` — the far endpoint of the linked connection (what the sig "leads to") — captured when the sig is/was linked, so the trail can name the destination of a link/unlink even after the hole collapses. All optional, so pre-fix historical payloads still parse; the canvas reducer (`applyEvent.ts`) ignores them. Endpoint/system ids resolve against the persistent (soft-deleted) `ap_map_system` rows, which outlive every event that names them.
  - **`signature.update.snapshot` (self-heal).** `signature.update` additionally carries an optional `snapshot: signatureBody` — the **full post-update row** — so a client missing this sig's baseline (reconnect gap, missed `signature.create`, reordering) can upsert the whole row in `applyEvent` instead of silently no-op'ing the merge-by-id. It is **additive and canvas-only**: the audit/Discord formatters read only the conditional changed-key fields and ignore `snapshot`, so audit precision and `updatedAt`-only no-op suppression are untouched. The snapshot's `leadsToMapSystemId` is populated for any still-linked sig (not just on a link change), so the Stage 4 restore offer can name a dormant connection's destination.
- `mapUpdateLoadSchema` (`{ mapId, kind?, data?: MapEventPayload }`) — `bus.ts` builds `{ mapId, kind, data }` from the notify payload.
- Other data-bearing loads (forward-declared): `mapConnectionAccessLoadSchema` (`{ mapId, data? }`), `logDataLoadSchema` (`{ mapId, data? }`).
- `characterUpdateLoadSchema` — `{ characterId, characterName, userId, mainCharacterId, mainCharacterName, online, systemId, systemName, systemSecurity, systemTrueSec, shipTypeId, shipTypeName, shipName, locationAt }`. `userId`/`mainCharacterId`/`mainCharacterName` carry the pilot's account + main identity so the roster keeps grouping alts under their main across live moves (both main fields null when no main is set). `characterName`, `shipTypeName`, `shipName`, and the `system*` fields are resolved server-side by the location-poll so the client renders the hover panel / pilot roster without a separate lookup; `shipTypeName` is null when `shipTypeId` is null, `shipName` (the pilot's custom hull name from `ap_character.last_ship_name`) is null before the first online tick, and `systemName`/`systemSecurity`/`systemTrueSec` (resolved `universe_system` fields) are null when `systemId` is null or unknown to the SDE. The schema is exposed publicly because the client presence-context re-uses it to parse incoming envelopes.
- `systemNotificationLoadSchema` — `z.discriminatedUnion('kind', …)` over `{ mapId, systemId }` plus a per-kind body. A transient system event broadcast by direct `pg_notify` bypassing `ap_map_event`; the bus discriminates on the top-level `task`. `systemId` is the EVE solar-system id; the client owns the visual treatment (`underglowPresets.ts`). Two kinds today:
  - `killmail` — server-observed zKillboard kill in an on-map system (`src/lib/integrations/zkbFeed.ts`); carries `killmail: { killmailId, shipTypeId, totalValue, href }`.
  - `ping` — user-initiated attention pulse; no extra body. The client POSTs `/api/map/[mapId]/ping` → `src/lib/map/ping.ts` fans it out; the initiator gets its own echo so every viewer pulses identically.
  Exposed publicly so the bus and the client bridge both parse it.
- `connectionMassLogLoadSchema` — `{ mapId, connectionId, logId, characterId, shipTypeId, mass, cumulativeMass, jumpedAt }`. A transient server-observed event (the location-poll logged a ship's wormhole jump). Like `characterUpdate`/`systemNotification`, broadcast by direct `pg_notify` bypassing `ap_map_event` (`src/lib/map/connectionMassLog.ts`). `connectionId`/`logId` are stringified bigints; `mass`/`cumulativeMass` are kg as numbers. The open connection inspector refetches its log on receipt. Exposed publicly so the bus and the client module both parse it.
- `serverToClientMessageSchema` — `z.discriminatedUnion('task', …)` over the ten server tasks (envelope + typed load).
- `clientToServerMessageSchema` — discriminated union over `subscribe` / `unsubscribe`.

### Notes
- Payload shapes are derived from Aperture's operational need.
- Adding a task name requires updating the spec (CLAUDE.md "Realtime").
