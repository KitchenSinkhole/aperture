## rights.ts

**Purpose:** Server-side permission gate. One module every controller and read path imports to answer "can this authenticated character perform this action on this map". Management authority is the derived-authority model — a pure function of EVE state + ownership (`canManageMap`), not the (retired) corp-right matrix.
**File:** `src/lib/auth/rights.ts`

---

### View rule (in order)

1. **Admin** — `authz_level='admin'` (global deployment operator) always wins.
2. **Owner match** per `ap_map.type`:
   - `private`  → `owner_character_id` matches the actor's id.
   - `corp`     → `owner_corporation_id` matches the actor's `corporation_id`.
   - `alliance` → `owner_alliance_id` matches the actor's `alliance_id`.
3. **Role overlay** — any `ap_character_role` row whose role appears in `ap_map_role_access` for the target map grants view.
4. Otherwise no view.

### Mutate rule (two tiers)

Mutation splits into two authority tiers keyed on the `MapRight`:

1. **`map_update` — content editing → view authority.** The live charting surface (add/move/remove systems, paste signatures, draw/edit/collapse connections, subchain delete, thera sync, disconnected cleanup) is open to **every viewer**. Anyone who can see the map — by ownership, corp/alliance membership, **or the role overlay** — can edit its content. Collaborative wormhole mapping is the product; read-only members would defeat it.
2. **All other rights (`map_delete`, `map_import`, `map_export`, `map_share`) — management → `canManageMap`.** Map configuration & lifecycle stay with admin, the private map's owner, the owning corp's Director, or the owning alliance's executor-corp Director. The corp-right matrix no longer participates.

Map **settings** edits (name/icon/behaviour flags/tagging) are a management surface too — gated by the `settings_manage` capability (`requireMapCapability`), **not** the view-level `map_update` right. See the per-title feature delegation section below.

**Unowned maps** (all three owner columns NULL) are admin-only. Defensive default that surfaces rows needing repair.

---

### canViewMap(characterId, mapId): Promise<boolean>
Returns `false` for non-existent / soft-deleted maps, kicked / banned characters, and anyone outside the view rule above.

### canMutateMap(characterId, mapId, right): Promise<boolean>
Two-tier resolver: `map_update` → `canViewMap` (content editing is open to every viewer); every other right → `canManageMap` (management). Throws if called with `'map_create'` (which has no target map; use `canCreateMap`).

### canCreateMap(characterId, type): Promise<boolean>
Typed create gate (derived authority). Admin → true. `private` → any active character. `corp` → `actor.is_director`. `alliance` → `actor.is_director && actor.corporation_id == executorCorpOf(actor.alliance_id)`. The caller resolves the owner FK from the actor's affiliation.

---

### Derived-authority model (permissions multi-tenant)

Map-**management** authority is a pure function of EVE state + ownership (`canManageMap`): it gates settings, lifecycle (delete), webhooks, audit, and import/export/share. **Content editing** (`map_update`) is separate — it resolves to `canViewMap`, so every viewer can chart. `canMutateMap` routes `map_update` → view and all other rights → manage; `requireMapManage` is the explicit management guard; `canCreateMap` is the typed create gate. The corp-right matrix no longer participates.

#### executorCorpOf(allianceId): Promise<bigint | null>
The alliance's executor corporation from the `ap_alliance` cache (`syncCharacterAuthz` keeps it fresh). `null` when the alliance is unknown or has no executor.

#### canManageMap(characterId, mapId): Promise<boolean>
Binary "can the actor manage this map" (full mutation surface + settings/webhooks/audit; no per-right granularity at baseline). Admin → true. `private` → `owner_character_id == actor`. `corp` → `actor.is_director && owner_corporation_id == actor.corporation_id`. `alliance` → `actor.is_director && owner_alliance_id == actor.alliance_id && actor.corporation_id == executorCorpOf(owner_alliance_id)`. All-NULL owner / missing / inactive → false.

### isAdmin(session): Promise<boolean>
Cheap session-level admin probe (`authz_level='admin'` AND `status='active'`) — does not touch any map table. The gate for the entire `/admin` operator console and all moderation actions.

### adminVisibilityScope(session): Promise<AdminVisibilityScope | null>
Returns `{ kind: 'global' }` for an active global admin, else `null`. `/admin` is operator-only — there is no corp-scoped variant — so this is effectively `isAdmin` returning a scope object. Callers branch on `null` and redirect / 403 as appropriate.

### requireMapRight(session, mapId, right): Promise<RightGuard>
Tuple-shaped guard for API routes. Returns `{ ok: true, characterId }` or `{ ok: false, status, error }`. Status codes:
- `401` — no session.
- `404` — map missing or no view access (does not leak existence — a 403 here would leak it).
- `403` — view-access OK but missing the right.

### requireMapView(session, mapId): Promise<RightGuard>
View-only variant for read endpoints (e.g. `GET /api/map/[mapId]/wormhole-types`).

### requireMapManage(session, mapId): Promise<RightGuard>
Management guard (session → view existence → `canManageMap`). Same `401 / 404 / 403` shape as `requireMapRight`, but requires full management authority rather than the view-level `map_update` content right. For a management call site that isn't keyed on a specific `MapRight` or capability. (The director-gated features route through `requireMapCapability` instead — see below.)

---

### Per-title feature delegation (R4)

A corp director can hand a single director-gated feature to a specific EVE corporation title by writing an `ap_map_role_access` row `(map_id, role_id, capability)`. A viewer's capabilities are the **union** across every title they hold (additive; no deny-grants). Managers/owners/admins hold every capability implicitly via `canManageMap`.

#### hasMapCapability(characterId, mapId, capability): Promise<boolean>
EXISTS a role the character holds granted `capability` on the map (`ap_map_role_access ⋈ ap_character_role`, capability-filtered). Does not consult management authority — use `canUseMapFeature` for the full gate.

#### canUseMapFeature(characterId, mapId, capability): Promise<boolean>
The single feature gate every delegated call site calls: `canManageMap(...) || hasMapCapability(...)`. A director/owner/admin passes implicitly.

#### resolveMapCapabilities(characterId, mapId): Promise<Set<MapCapability>>
The set of capabilities the character can exercise on the map. Managers get every `map_capability` value; everyone else gets the union their held titles grant (one query). Feeds the client capability reveal.

#### requireMapCapability(session, mapId, capability): Promise<RightGuard>
Tuple-shaped guard for a delegated feature endpoint / action: session (401) → view existence (404, does not leak) → `canUseMapFeature` (403). Same shape as `requireMapManage`, keyed on a specific capability.

### assertMapRight(session, mapId, right): Promise<characterId>
Throws `RightAssertionError` on failure. The Server Action variant of `requireMapRight`.

### viewableMapPredicate(characterId)
Returns a drizzle `where` clause that filters `ap_map` rows to those the actor can view. Returns `undefined` for admins (no filter). Used by `listViewableMaps` to push permission into SQL instead of post-filtering rows in app code.

### RightAssertionError extends Error
Carries `.status` (401/403/404) for the call site to map to an HTTP response.

---

### Depends On
- Session: `next-auth` session type via `@/lib/session`.
- Schema: `ap_character`, `ap_map`, `ap_map_role_access`, `ap_character_role`, `ap_alliance`, `mapCapability` enum.
- Types: `MapCapability`, `MapRight`, `MapType` from `@/types`.

### Invariants
- A `kicked` or `banned` character fails every check, regardless of the rest of their state. (Ban/kick is also gated at login; this is defense-in-depth for any session that was issued before the kick landed.)
- No call here ever rotates an ESI token or hits ESI.
- Every helper is read-only on the DB.

### Runtime note
- **No `import 'server-only'`** in this file. It is imported by `src/lib/realtime/wsServer.ts`, which loads in the custom Node entry (`tsx watch server.ts`) without Next.js's `react-server` resolver condition. Under plain Node, `server-only`'s default export throws on load. Every actual caller is server-side (API routes, Server Actions, the WS upgrade handler); we rely on that rather than the marker package.
