## syncCharacterAuthz.ts

**Purpose:** Reconcile one character's derived authority state (`authz_level`, affiliations, corp-title role memberships) against ESI in a single transactional pass. Called from the Auth.js JWT callback on initial sign-in and the `character-cleanup` job's periodic resync.
**File:** `src/lib/auth/syncCharacterAuthz.ts`

---

### syncCharacterAuthz(characterId: bigint): Promise<SyncCharacterAuthzResult>

Pulls four ESI sources in parallel — `fetchAffiliations` (corp/alliance via the ~1h-cached affiliation endpoint), `getCharacterRoles`, `getCharacterTitles`, and `getCharacter` (public profile, consumed only for `name`) — then, when the character has an alliance, a follow-up `getAlliance`, then runs a single transaction that:

1. **Upserts `ap_corporation`** for the character's corp id (FK target for role rows). Refreshes `alliance_id` and `last_synced_at`; leaves `name` alone (filled by the dedicated corp-name resolver).
1b. **Upserts `ap_alliance`** when the character belongs to one — caches `name` + `executor_corporation_id` from `getAlliance`. This is the only writer of `ap_alliance`; the executor corp drives alliance-map authority in `canManageMap`.
2. **Updates `ap_character`** — sets `name` (from `getCharacter`'s public profile, the authoritative source that tracks a CCP rename; the login-time SSO `name` claim can lag it indefinitely), `corporation_id`, `alliance_id`, `is_director`, `authz_synced_at`, and `authz_level` to the value returned by `resolveAuthzLevel(characterId)` (`src/lib/auth/resolveAuthz.ts`). `is_director` is the raw ESI Director bit (carries corp/alliance map authority in the derived model), distinct from `authz_level`. The level is a deterministic cache written verbatim every pass: `'member'` or `'admin'` only — global `'admin'` comes only from an explicit `ap_access_grant` `capability='admin'`; the Director role does not raise the tier. There is no `CASE` preserve-hack — the resolver, not a sticky column, is what keeps explicit grants across resyncs.
3. **Reconciles `ap_character_role` rows with `source='corp_title'`** — upserts an `ap_role` per ESI title (`external_ref='<corp_id>:<title_id>'`), inserts memberships for newly held titles, deletes memberships for titles no longer returned by ESI. Built-in / external (Discord) role grants are untouched.

**ESI failures (`EsiBreakerOpenError`, `EsiDowntimeError`, `EsiTokenError`, `EsiTokenTransientError`, `EsiHttpError`)** cause the function to return `{ applied: false, skipped: <reason> }` *before* touching the DB. Unexpected errors propagate to the caller. A character ESI omits from the affiliation response (rare — e.g. biomassed) is also treated as a skip (`skipped: 'esi-http'`) so a live corp/alliance is never stomped to null.

**Returns** `SyncCharacterAuthzResult`:
- `authzLevel` — `'member' | 'admin'`, the exact value written to the row (the `resolveAuthzLevel` result; reflects explicit grants).
- `isDirector` — whether the Director role was present (also persisted to `ap_character.is_director`).
- `corporationId`, `allianceId` — the affiliations written.
- `executorCorporationId` — the alliance's executor corp from the `ap_alliance` upsert; `null` when unaffiliated.
- `titleCount` — number of `corp_title` roles reconciled.
- `applied` — `true` if the DB was updated; `false` with a `skipped` reason if ESI was unreachable.

### Depends On
- ESI: `fetchAffiliations` (`src/lib/esi/affiliation.ts`, corp/alliance); `getCharacter`, `getCharacterRoles`, `getCharacterTitles`, `getAlliance` via `esiCall`.
- `resolveAuthzLevel` (`src/lib/auth/resolveAuthz.ts`) — computes the cached `authz_level`.
- Schema: `ap_character`, `ap_corporation`, `ap_alliance`, `ap_role`, `ap_character_role`; `ap_access_grant` (read indirectly via the resolver).
- Constants: `apertureConfig.AUTHZ_ADMIN_ROLE` (`'Director'`).

### Invariants
- A character with no explicit `admin` grant ends up with `authz_level='member'`, regardless of their Director role (which is persisted to `is_director` instead).
- A character whose Director role changes in-game has `is_director` updated on the next sync; their `authz_level` is unaffected (the two are independent).
- A hand-assigned `admin` grant survives every resync because the resolver re-reads it each pass — not because the column is preserved.
- ESI failure never leaves a partial sync — the transaction either runs to completion or no DB write happens.
- `ap_character.name` follows ESI's public profile, not the login-time SSO claim: a CCP rename self-heals on the next sync pass without requiring the character to log in again.
