## settings.ts (admin server actions)

**Purpose:** Admin instance-settings actions at `/admin/settings`. Global-admin-only deployment-wide knobs on `ap_instance`. (The corp-rights matrix actions were removed in the Stage-4 teardown — migration 0041 dropped `ap_corporation_right`.)
**File:** `src/app/(admin)/actions/settings.ts`

---

### adminSetStaleSignatureThreshold({ minutes }): Promise<ActionResult>
Sets the instance-wide default stale-signature threshold (`ap_instance.stale_signature_threshold_minutes`). Zod-validates `minutes` as an integer in `[1, 10080]` (one week). Gated to **global admins only** via `isAdmin`. Per-account overrides, capped at this value, live on `ap_user` (`setSignatureIndicatorPrefsAction`). Revalidates `/admin/settings`.

### adminSetRouteSettingsKeepOpen({ keepOpen }): Promise<ActionResult>
Sets the instance-wide default for whether the route planner's settings popover survives an outside press (`ap_instance.route_settings_keep_open`). Zod-validates `keepOpen` as a boolean. Gated to **global admins only** via `isAdmin`. Accounts override it either way on `ap_user.route_settings_keep_open`; an account that has never set it follows this value. Revalidates `/admin/settings`.

### adminSetOverlayFitOverflow({ policy }): Promise<ActionResult>
Sets the instance-wide policy for the system overlay's fit-columns-to-content action when the fit is wider than the overlay window (`ap_instance.overlay_fit_overflow`). Zod-validates `policy` against the `overlay_fit_overflow` enum values. Gated to **global admins only** via `isAdmin`. There is no per-account override. Revalidates `/admin/settings`.

---

### Depends on
- `auth` / `isAdmin` — `@/lib/auth/rights`.
- `apInstance` — `@/db/schema`; `overlayFitOverflow` — `@/db/schema/ap/enums`.

### Notes
- No `ap_map_event` row is written. Instance config is not map state; `ap_map_event` is map-scoped, so these changes are intentionally out of its scope.
