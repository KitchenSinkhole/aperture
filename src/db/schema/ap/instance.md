## instance.ts

**Purpose:** Per-deployment access configuration — the singleton `ap_instance` config row and the `ap_instance_owner` ownership list.
**File:** `src/db/schema/ap/instance.ts`

---

### apInstance
`pgTable('ap_instance', …)` — singleton config row (there is exactly one):
- `id` — `smallint` PK, pinned to `1` by CHECK `ap_instance_singleton_chk` (`id = 1`).
- `access_mode` — `access_mode` enum, required, default `restricted`. `restricted` gates login behind owner membership + the allowlist; `open` allows any EVE account to log in.
- `stale_signature_threshold_minutes` (`staleSignatureThresholdMinutes`) — `integer NOT NULL DEFAULT 240` (migration `0035`). Global default for the stale-signature map indicator: a system whose newest signature is older than this (or a wormhole system with no signatures) is flagged. Admins edit it via `/admin/settings` (`adminSetStaleSignatureThreshold`); each account may override it to a *smaller* value on `ap_user.stale_signature_threshold_minutes`. Resolved per-user by `getSignatureIndicatorPrefs` (`session.ts`).
- `updated_at` — `timestamptz`, default `now()`.

**Constraints:**
- `ap_instance_singleton_chk` — CHECK `(id = 1)`. Forbids a second config row.

Read/written via `/setup` and consulted by the login gate.

### apInstanceOwner
`pgTable('ap_instance_owner', …)` — the corp(s)/alliance(s) that own this deployment:
- `principal_kind` — `access_principal` enum, required, CHECK-constrained to `corporation` / `alliance`.
- `principal_id` — `bigint`, required. EVE corporation_id or alliance_id. No FK (`ap_corporation` is a sparse cache; no alliance table exists app-wide).
- `created_at` — `timestamptz`, default `now()`.

**Constraints:**
- `ap_instance_owner_pk` — composite PK `(principal_kind, principal_id)`.
- `ap_instance_owner_kind_chk` — CHECK `principal_kind IN ('corporation','alliance')`. An instance is owned by an organisation, never a single character or role.

**Semantics:** members of an owner entity are implicitly allowed to log in (no self-lockout). Ownership is login-gating only — it does NOT confer authz; global `admin` comes solely from an explicit `ap_access_grant` (`capability='admin'`, `resolveAuthzLevel`). Owner designation lives in the DB so it is reachable from the password-gated `/setup` console before anyone can log in.
