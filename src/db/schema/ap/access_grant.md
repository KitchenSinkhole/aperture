## access_grant.ts

**Purpose:** The unified `ap_access_grant` table — one row grants one principal one capability at one scope (allowlist entries, super-admin hand-grants, and reserved map-scope shares).
**File:** `src/db/schema/ap/access_grant.ts`

---

### apAccessGrant
`pgTable('ap_access_grant', …)`:
- `id` — `bigserial` PK.
- `principal_kind` — `access_principal` enum, required (`character` / `corporation` / `alliance` / `role`).
- `principal_id` — `bigint`, required. EVE id, or `ap_role.id` when kind=`role`. No FK (the principal may have no `ap_*` row yet; kinds resolve to different tables).
- `scope` — `access_scope` enum, required. `instance` (login/admin/blackout_view) or `map` (view/edit).
- `map_id` — `bigint`, nullable, FK → `ap_map.id` `ON DELETE CASCADE`. NULL ⇔ `scope='instance'`.
- `capability` — `access_capability` enum, required.
- `expires_at` — `timestamptz`, nullable. NULL = permanent; past = ignored by callers (and reaped by a future sweep); future = time-boxed.
- `note` — `text`, nullable. Optional admin annotation.
- `granted_by_character_id` — `bigint`, nullable, FK → `ap_character.id` `ON DELETE SET NULL`. The issuing operator; SET NULL preserves the audit trail when erased.
- `granted_at` — `timestamptz`, default `now()`.

**Constraints:**
- `ap_access_grant_principal_capability_uq` — UNIQUE **NULLS NOT DISTINCT** `(principal_kind, principal_id, scope, map_id, capability)`. `NULLS NOT DISTINCT` so instance grants (map_id NULL) still dedupe — without it Postgres treats two NULL map_ids as distinct and allows duplicates.
- `ap_access_grant_scope_map_chk` — CHECK `(scope='instance') = (map_id IS NULL)`. Scope and map_id move together.
- `ap_access_grant_capability_scope_chk` — CHECK pairing capability with scope: instance ⇒ `login`/`admin`/`blackout_view`; map ⇒ `view`/`edit`.
- `ap_access_grant_blackout_principal_chk` — CHECK `capability <> 'blackout_view' OR principal_kind IN ('character','role')` (migration 0072). The Blackout cleared list names characters and titles only; corporations and alliances are the audience a Blackout hides pilots from.
- `ap_access_grant_principal_idx` — btree on `(principal_kind, principal_id)`. Backs the resolver's "all grants for this principal" lookup.
- `ap_access_grant_map_id_idx` — btree on `(map_id)`. Backs the sharing read-path "all grants on this map".

**What each row means now:**
- `scope='instance', capability='login'` — allowlist entry.
- `scope='instance', capability='admin'` — explicit super-admin hand-grant on a character (read by `resolveAuthzLevel`).
- `scope='instance', capability='blackout_view'` — a Blackout cleared-list entry on a character or a title (`role`), optionally time-boxed by `expires_at` (read by `isBlackoutCleared`). Never confers login: the login gate reads only `login` / `admin`.

**Reserved for the sharing feature** (table exists; read-path consult added with that feature):
- `scope='map', capability='view' | 'edit'` — a named-entity map share; non-null `expires_at` ⇒ temporary, auto-revoked.
