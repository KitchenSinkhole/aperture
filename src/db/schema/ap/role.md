## role.ts

**Purpose:** The three role tables — `ap_role` (registry), `ap_character_role` (membership), `ap_map_role_access` (per-map grant). Together they support corp-title-driven and external (Discord, etc.) per-map access overlays on top of `ap_map.type` + owner FKs.
**File:** `src/db/schema/ap/role.ts`

---

### apRole
`pgTable('ap_role', …)`:
- `id` — `bigserial` PK.
- `source` — `role_source` enum, required (`builtin` / `corp_title` / `external`).
- `external_ref` — `text`, nullable. For `corp_title`, `'<corporation_id>:<title_id>'`. For `external`, the upstream role id. NULL for `builtin`.
- `name` — `text`, required. Canonical name (e.g. the title string from ESI).
- `display_label` — `text`, nullable. Optional human-friendly label; UI falls back to `name`.
- `corporation_id` — `bigint`, nullable, FK → `ap_corporation.id` `ON DELETE CASCADE`. Scopes `corp_title` rows to the issuing corp; NULL for `builtin` / `external`.
- `created_at` — `timestamptz`, default `now()`.

**Constraints:**
- `ap_role_source_external_ref_uq` — unique `(source, external_ref)`. Each upstream identity maps to exactly one role row.
- `ap_role_corporation_id_idx` — btree on `(corporation_id)`. Backs the corp-title picker query.

### apCharacterRole
`pgTable('ap_character_role', …)`:
- `character_id` — `bigint`, FK → `ap_character.id` `ON DELETE CASCADE`.
- `role_id` — `bigint`, FK → `ap_role.id` `ON DELETE CASCADE`.
- `granted_at` — `timestamptz`, default `now()`.
- `granted_by` — `text`, nullable. Provenance: `'corp-title-sync'`, `'<character_id>'` (admin grant), `'discord-sync'`, …

**Constraints:**
- `ap_character_role_pk` — composite PK `(character_id, role_id)`.
- `ap_character_role_role_id_idx` — btree on `(role_id)`. Backs "who holds this role" queries.

`corp_title` rows are owned end-to-end by `syncCharacterAuthz` — it inserts on title-gained and deletes on title-lost. Built-in / external rows are managed by their respective sync paths and never touched by the title-sync.

### apMapRoleAccess
`pgTable('ap_map_role_access', …)`:
- `map_id` — `bigint`, FK → `ap_map.id` `ON DELETE CASCADE`.
- `role_id` — `bigint`, FK → `ap_role.id` `ON DELETE CASCADE`.
- `capability` — `map_capability` enum, required (migration 0056). Which per-map feature this grant unlocks for the role.
- `granted_at` — `timestamptz`, default `now()`.

**Constraints:**
- `ap_map_role_access_pk` — composite PK `(map_id, role_id, capability)`.
- `ap_map_role_access_role_id_idx` — btree on `(role_id)`. Backs "which maps does this role unlock" queries used by `listViewableMaps`.

Semantics: a character holding any role with **any** row for a map gets **view access** to it — the view read paths (`hasRoleAccess`, `viewableMapPredicate`) match on `role_id` alone with no capability filter, so a `capability='view'` row and a feature grant (e.g. `audit_view`) both imply visibility. Feature access is the capability-filtered gate `canUseMapFeature` / `hasMapCapability`: a director-gated feature is granted to a title by inserting the matching `(map_id, role_id, capability)` row. Capabilities are **additive** across the titles a character holds (union; no deny-grants). Full management authority remains the derived `canManageMap` (owner / corp Director / executor-corp Director / admin; see `src/lib/auth/rights.ts`) — a manager holds every capability implicitly, so delegation only ever adds a non-manager title.

Delegation is **corp-scoped in v1**: only a corp map's owning-corp `corp_title` roles are eligible targets. The alliance seam is additive — alliance support extends only (a) which titles list for an alliance map and (b) resolving a viewer's titles across member corps; the `role_id → capability` model itself is already corp-agnostic. Private maps have no titles.
