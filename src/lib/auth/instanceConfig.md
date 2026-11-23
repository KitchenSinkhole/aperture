## instanceConfig.ts

**Purpose:** Read/write helper for the per-deployment access configuration the `/setup` ops console drives — `ap_instance.access_mode`, `ap_instance_owner` entries, and the instance-scoped `ap_access_grant` allowlist (login/admin).
**File:** `src/lib/auth/instanceConfig.ts`

Pure DB layer — no auth gating (the caller, `(setup)/actions.ts`, gates on the `ap_setup` cookie). No `import 'server-only'`, mirroring [[loginGate]] / [[resolveAuthz]] so it loads under plain Node for tests. Writes affect live-read paths (login gating in [[loginGate]]) immediately; the cached `ap_character.authz_level` updates on the affected character's next resync.

---

### getInstanceConfig(): Promise<InstanceConfig>
Reads the whole config in one shot for the setup page: the singleton `access_mode` + `updated_at`, all `ap_instance_owner` rows (ordered kind, id), and the instance-scoped `login` / `admin` `ap_access_grant` rows (ordered capability, kind, id). Blackout cleared-list (`blackout_view`) grants are not part of the allowlist and are excluded. A missing singleton row reports `accessMode: 'restricted'` (a fresh deployment is locked down, matching `loginGate.getAccessMode`).

**Returns:** `{ accessMode, updatedAt, owners: InstanceOwnerRow[], grants: InstanceGrantRow[] }`. Bigint ids are `bigint`; the `/setup` actions serialize them to strings for the client.

### setAccessMode(mode: AccessMode): Promise<void>
Upserts the singleton `ap_instance` row (`id = 1`) with the chosen mode, bumping `updated_at`.

### addOwner(kind: OwnerKind, principalId: bigint): Promise<void>
Inserts an owner organisation (`corporation` | `alliance`). Idempotent on the `(kind, id)` primary key (`onConflictDoNothing`).

### removeOwner(kind: OwnerKind, principalId: bigint): Promise<void>
Deletes an owner row. No-op if absent.

### addInstanceGrant(input: AddInstanceGrantInput): Promise<void>
Issues (or refreshes) an instance-scoped grant. `input`: `{ principalKind: 'character'|'corporation'|'alliance'|'role'; principalId: bigint; capability: 'login'|'admin'; expiresAt?; note?; grantedByCharacterId? }`. Always writes `scope='instance'`, `map_id=NULL`. Re-issuing an existing `(principalKind, principalId, capability)` refreshes `expires_at`/`note`/`granted_by`/`granted_at` via `onConflictDoUpdate` instead of erroring on the unique constraint.

### removeGrant(id: bigint): Promise<void>
Deletes an instance-scoped grant by id. The `scope='instance'` guard stops this ops-console path from touching reserved `scope='map'` share rows.

---

### Notes
- `OwnerKind`, `InstanceGrantCapability`, `GrantPrincipalKind`, `InstanceOwnerRow`, `InstanceGrantRow`, `InstanceConfig`, `AddInstanceGrantInput` are exported for the actions/UI to type against.
- Login gating reads grants live, so an added `login` grant admits new sign-ins immediately; `authz_level` (admin) is a cache resolved on resync by [[resolveAuthz]].
