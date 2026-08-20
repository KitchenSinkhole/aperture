## structure.ts

**Purpose:** The `ap_structure` table — manual structure-intel: one row per player-owned structure spotted in a system. System-scoped rather than map-scoped, with a separate `scope` triple naming who may see the row.
**File:** `src/db/schema/ap/structure.ts`

---

### apStructure
`pgTable('ap_structure', …)`:
- `id` — `bigserial` PK, app-generated (no natural EVE id; manual entry).
- `system_id` — `integer` FK → `universe_system.id` `ON DELETE RESTRICT`.
- `name` — `text`, not null. User-typed structure name.
- `structure_type_id` — `integer` FK → `universe_type.id` `ON DELETE RESTRICT`. The Upwell structure type (Astrahus, Fortizar, Keepstar, Raitaru, Azbel, Sotiyo, Athanor, Tatara, Ansiblex, …). Real FK because type is static SDE data.
- `owner_corporation_id` — `bigint` FK → `universe_corporation.id` `ON DELETE RESTRICT`, nullable. The corp picked from the ESI search; the name is read from the FK'd `universe_corporation` cache row (single source of truth). **Not** an FK to `ap_corporation` (that table is member-corps-only for the rights matrix). Null when the owner is unknown.
- `notes` — `text`, nullable. Free-text intel.
- `scope` — `intel_scope` enum (`private` | `corp` | `alliance`), not null (migration 0070). Who may read and mutate the row.
- `scope_character_id` — `bigint` FK → `ap_character.id` `ON DELETE SET NULL`, nullable (migration 0070). Populated on `private` rows.
- `scope_corporation_id`, `scope_alliance_id` — bare `bigint`, nullable (migration 0070). Populated on `corp` / `alliance` rows respectively. Not FKs: `ap_corporation` / `ap_alliance` are not FK targets app-wide.
- `created_by_character_id` — `bigint` FK → `ap_character.id` `ON DELETE SET NULL` (audit; never cascade-wipe intel when a character is erased).
- `created_at` / `updated_at` — `timestamptz`, default `now()`.

**Indexes:** `system_id` (`ap_structure_system_id_idx`) for the per-system module read; `(scope, scope_corporation_id, scope_alliance_id, scope_character_id)` (`ap_structure_scope_idx`) for the per-viewer visibility filter.

**Constraint:** `ap_structure_scope_matches_owner_chk` — the populated `scope_*` column matches `scope`, and no more than one is populated.

### Notes
- **Manual entry, not ESI.** ESI `getUniverseStructure` only returns structures the calling character can dock at, so it cannot supply intel on other corps' structures. There is no ESI structure-resolve path.
- **Tenancy is `scope` + the `scope_*` triple, and it is orthogonal to `owner_corporation_id`.** `owner_corporation_id` is the citadel's in-game owner and carries no visibility meaning; `scope_corporation_id` is the corporation whose members may see the row. Scope is derived from the map a row was written on, never from the writer's own affiliation, so an NPC corp can never become a scope.
- **A row with all three `scope_*` columns NULL is admin-only** — the same defensive default `canViewMap` applies to an unowned map. The CHECK admits that state only under `scope='private'`, which is the one way it arises: `scope_character_id` is `ON DELETE SET NULL`, so erasing a character orphans their private rows rather than deleting the intel. A `corp` or `alliance` row with nothing populated is rejected outright.
