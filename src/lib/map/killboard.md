## killboard.ts

**Purpose:** Server-side reader that fetches recent zKillboard kills for a system and enriches each with victim, ship, kill time, and attacker count for the system-killboard module.
**File:** `src/lib/map/killboard.ts`

---

### killboardForSystem(systemId: number, limit: number): Promise<KillboardKill[]>
Calls `recentKillsForSystem` (zkb client) for the `{ killmailId, hash, totalValue }` list, then enriches:
- Full killmail bodies resolved cache-aside against `universe_killmail` (see `loadKillmails`): cached ids are served from the table, only misses hit `getKillmail`, and fetched bodies are written back. Supplies `killmail_time`, victim ids, `ship_type_id`, and attacker count.
- Ship display names resolved from `universe_type` in one `inArray` query; ship icons are `ccpImageUrl('types', …, 'icon', 64)`.
- Victim display names resolved in one batched `getUniverseNames` (best-effort; degrades to ids on failure). Victim icon is the character portrait, or the corporation logo for NPC/structure victims with no character.

Propagates `ZkbRateLimitError` / `ZkbHttpError` to the caller (the route maps them to 429/502). ESI failures are swallowed per-row.

`loadKillmails(kills)` — cache-aside resolver returning a `Map<killmailId, EsiKillmail>`. Batches a `SELECT` from `universe_killmail`, fetches only the misses via `getKillmail` (breaker-gated, one call each, per-row failures degrade to a missing entry), and `INSERT … ON CONFLICT DO NOTHING`s the fetched bodies. Killmail bodies are immutable, so a cached row is authoritative forever and is never re-fetched.

### Types
- `KillboardKill` — `RecentKillSummary & { killmailTime, shipTypeId, shipName, shipIcon, victimName, victimIcon, attackers }` (all nullable).

### Depends on
- `@/lib/integrations/zkb` (`recentKillsForSystem`), `@/lib/esi/client` (`esiCall`) + `@/lib/esi/decoders` (`killmailSchema`, `universeNamesSchema`), `@/lib/integrations/links` (`ccpImageUrl`), `@/db` (`universeType`, `universeKillmail`).
