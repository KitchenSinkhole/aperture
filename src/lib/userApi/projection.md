## projection.ts

**Purpose:** Builds each user API resource of one map as its own wire DTO (`map`, `signatures`, `pilots`, `notes`, `mass_log`, `kills`).
**File:** `src/lib/userApi/projection.ts`

Built from the viewer-independent loaders `loadMapForView` composes (`loadVisibleMapSystems`, `loadVisibleMapConnections`, `loadSignaturesForSystems`, `loadMapNotes`, `loadMapPresence`), so the visibility predicates are the in-app ones: visible systems only; connections confirmed and with both endpoints visible; signatures and intel notes only in visible systems. Each DTO is mapped field by field from those view models, never spread, so an internal view-model change cannot reach the wire. Bigint ids are strings, timestamps ISO. No field anywhere carries an account id (`userId`). No access check: the request pipeline has already authorised the token.

---

### loadUserApiProjection<R extends UserApiResource>(mapId: bigint, resource: R, viewer: BlackoutViewer): Promise<UserApiPayload<R>>
One resource of one map as the token owner `viewer` may see it. The payload is the envelope's `data` plus, for a withheld mass log only, `hidden: true`.

| Resource | `data` |
|---|---|
| `map` | `UserApiMap`: the header (`id`, `name`, `scope`, `type`, `homeMapSystemId`), visible systems, confirmed connections. No intel-notes text. Throws when the map row is gone or soft-deleted. |
| `signatures` | `UserApiSignature[]` in visible systems, each carrying its system's EVE id and name. |
| `pilots` | `UserApiPilot[]` from `loadMapPresence(mapId, viewer)`: while Blackout restricts `viewer`, only that account's own pilots. Keeps `mainCharacterId` / `mainCharacterName`. |
| `notes` | `UserApiNotes`: every free-standing map note, plus `systemNotes` for each visible system with intel-notes text. |
| `mass_log` | `UserApiMassLogEntry[]` for jumps through confirmed, visible connections, newest first, each with the EVE ids of the connection's two ends. `{ data: [], hidden: true }` while `isBlackedOut(viewer)`, without a query. |
| `kills` | `UserApiKill[]` from the local `universe_killmail` cache only: the newest `USER_API_KILLS_MAX_LIMIT` kills in visible systems within the last `USER_API_KILLS_MAX_AGE_DAYS`, newest first. Ids, victim ids and attacker count come from the stored body, the ship-type name from `universe_type`, `totalValue` from `total_value`. No zKillboard or ESI call. Any `since` inside that window and any `limit` up to that cap select a prefix of this list. |

**Parameters:**
- `viewer` — the owning account's `BlackoutViewer` (the resolved token's `record.access.blackout`); read only by `pilots` and `mass_log`.

---

### Depends On
- `@/lib/map/loadMap` (`loadVisibleMapSystems`, `loadVisibleMapConnections`, `loadMapNotes`, `loadMapPresence`), `@/lib/map/systemNode` (`loadSignaturesForSystems`), `@/lib/map/connectionMassLog` (`listMapConnectionMassLog`), `@/lib/auth/blackout` (`isBlackedOut`).
- Schema: `ap_map` (the header), `universe_killmail` and `universe_type` (`kills`).
- `aperture.config` (`USER_API_KILLS_MAX_AGE_DAYS`, `USER_API_KILLS_MAX_LIMIT`).
- Types: `UserApiResource`, `UserApiPayload`, `UserApiProjectionData` and the per-resource DTOs (`src/types/index.ts`).
