## account.ts

**Purpose:** Account self-service Server Actions over `ap_user` — set the main character, toggle preferences (travel animation, signature indicators), save the map layout, and delete the account.
**File:** `src/app/(app)/actions/account.ts`

---

### setMainCharacterAction(targetCharacterId: string): Promise<AccountActionResult>
Sets `ap_user.main_character_id` to `targetCharacterId` for the current account. Validates the target is an active, owned character via `assertCharacterOwnership`. Revalidates the `/` layout so the header / switcher reflect the new main. Returns `{ ok: false, error }` on an invalid or unowned target.

**Returns:** `{ ok: true }` on success.

---

### setConnectionTravelAnimationAction(enabled: boolean): Promise<AccountActionResult>
Sets `ap_user.connection_travel_animation` for the current account. Revalidates the `/` layout so the toggle's initial state (threaded through the app layout) and any open map reflect the change. Always returns `{ ok: true }` — there is nothing to validate beyond the session.

---

### setSignatureIndicatorPrefsAction({ thresholdMinutes, showStale, showUnscanned }): Promise<AccountActionResult>
Persists the account's stale/unscanned signature-indicator preferences to `ap_user`. `thresholdMinutes` is an optional stale-threshold override: `null` clears it (use the global default); a non-null value must be a positive integer and is **capped at the global default** (`getGlobalStaleThresholdMinutes`) — a value larger than the corp default is rejected with `{ ok: false, error }`, so a user can only make the indicator more eager, never ignore it. The two booleans toggle each indicator. Revalidates the `/` layout so an open map picks up the change. Personal — no per-map row.

---

### setMapLayoutAction(config: unknown): Promise<AccountActionResult>
Persists the account's free-form map dashboard layout (map-layout-builder) to `ap_user.map_layout`. `config` is unknown user JSON (posted by the grid's debounced save) — validated at this boundary with `mapLayoutConfigSchema` (`src/lib/map/layout/schema.ts`); a parse failure returns `{ ok: false, error: 'Invalid layout.' }`. The validated blob passes through `migrateLayout` so an ungrouped (pre-v2) payload never reaches the column. On success updates the column + `updated_at`, revalidates the `/` layout so a freshly-rendered map picks up the arrangement, and returns `{ ok: true }`. One global layout per account, applied to every map.

---

### deleteAccountAction(): Promise<AccountActionResult>
Hard-deletes the `ap_user` row for the current session. The FK cascade removes characters / roles / tracking; `ap_map_event` and `ap_structure_event` rows keep their history with `character_id` set null; owned maps are orphaned (`owner_character_id` set null). No soft-delete grace — irreversible. On success calls `signOut({ redirectTo: '/' })`, which throws a redirect (the trailing `{ ok: true }` is unreachable but satisfies the type). Returns `{ ok: false, error }` only if the delete itself fails.

---

### AccountActionResult (type)
`{ ok: true } | { ok: false; error: string }` — mirrors the small result union in `actions/character.ts`.
