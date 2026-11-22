## settings.ts (admin server actions)

**Purpose:** Admin instance-settings actions at `/admin/settings`. Global-admin-only deployment-wide knobs on `ap_instance`. (The corp-rights matrix actions were removed in the Stage-4 teardown — migration 0041 dropped `ap_corporation_right`.)
**File:** `src/app/(admin)/actions/settings.ts`

---

### adminSetStaleSignatureThreshold({ minutes }): Promise<ActionResult>
Sets the instance-wide default stale-signature threshold (`ap_instance.stale_signature_threshold_minutes`). Zod-validates `minutes` as an integer in `[1, 10080]` (one week). Gated to **global admins only** via `isAdmin`. Per-account overrides, capped at this value, live on `ap_user` (`setSignatureIndicatorPrefsAction`). Revalidates `/admin/settings`.

---

### adminSetUserApiEnabled({ enabled }): Promise<ActionResult>
Turns the per-map user API on or off for the whole instance (`ap_instance.user_api_enabled`, upserting the singleton row). Gated to **global admins only** via `isAdmin`. Off answers 404 on every `/api/v1/*` route and refuses minting, whatever each map says. Calls `invalidateUserApiInstanceSwitch()` after the write commits, so the next request reads the new value. Revalidates `/admin/settings`.

---

### Depends on
- `auth` / `isAdmin` — `@/lib/auth/rights`.
- `apInstance` — `@/db/schema`.
- `invalidateUserApiInstanceSwitch` — `@/lib/userApi/instance`.

### Notes
- No `ap_map_event` row is written. Instance config is not map state; `ap_map_event` is map-scoped, so these changes are intentionally out of its scope.
