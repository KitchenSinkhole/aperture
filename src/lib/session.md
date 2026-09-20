## session.ts

**Purpose:** Server-only account/session helpers wrapping Auth.js `auth()` — resolves the active character and the account's character roster, and centralizes the character-ownership authorization check.
**File:** `src/lib/session.ts`

---

### getSession(): Promise<Session | null>
The current Auth.js session, or `null` when logged out.

### requireSession(): Promise<Session>
The current session; `redirect('/')` to the public splash when (a) there is no session, or (b) the active character's `status !== 'active'` (kicked or banned characters lose every gated route on their next request, not just the next sign-in). Used by the `(app)` and `(admin)` layouts to gate the authenticated tree, and by every Server Action that mutates state.

### getActiveCharacter(): Promise<ApCharacter | null>
The full `ap_character` row for `session.characterId`, or `null` when logged out / character missing.

### getAccountCharacters(userId: number): Promise<AccountCharacter[]>
All characters on the account, ordered by name. Returns only display-safe fields (`id` as string, `name`, `status`, `authzLevel`) — never ESI tokens. The header Characters panel's per-map tracking checkboxes read their state from `getMapTrackingAction(mapId)`, not from this roster (tracking is per-map, not a per-character flag).

### getMainCharacterId(userId: number): Promise<string | null>
The account's `ap_user.main_character_id` as a string (bigint isn't JSON-safe), or `null` when unset. Feeds the Account Settings "main" selector; login-time resolution / bootstrap lives in `auth.ts` (`resolveMainCharacter`).

### getConnectionTravelAnimation(userId: number): Promise<boolean>
The account's `ap_user.connection_travel_animation` toggle (defaults to `true` when the row is missing). Threaded through the app layout to the Account Settings toggle and to `MapCanvas`, where it gates whether jump-traversals play the moving-dot animation.

### getMapLayout(userId: number): Promise<MapLayoutConfig | null>
The account's `ap_user.map_layout` — the free-form map dashboard arrangement (map-layout-builder), or `null` when unset (the client then falls back to `DEFAULT_MAP_LAYOUT`). One global layout per account, applied to every map. Loaded in `map/[[...slug]]/page.tsx` and passed to `MapCanvas`; written by `setMapLayoutAction` (`actions/account.ts`).

### getGlobalStaleThresholdMinutes(): Promise<number>
The instance-wide default stale-signature threshold (`ap_instance.stale_signature_threshold_minutes`), defaulting to 240 (4h) when the singleton row is somehow missing. The cap for per-account overrides.

### getSignatureIndicatorPrefs(userId: number): Promise<SignatureIndicatorPrefs>
The account's *resolved* signature-indicator prefs for client rendering: the effective `thresholdMinutes` (the `ap_user` override, capped to the global default — a defensive `Math.min` even though the write action already enforces it) plus `showStale` / `showUnscanned`. Loaded in `map/[[...slug]]/page.tsx`, passed to `MapCanvas` → `MapSignatureIndicatorContext`.

### getSignatureIndicatorAccountSettings(userId: number): Promise<{ globalThresholdMinutes; userThresholdMinutes; showStale; showUnscanned }>
Raw (un-resolved) values for the Account Settings dialog: the global cap, the account's own override (or `null`), and the two toggles. Written by `setSignatureIndicatorPrefsAction` (`actions/account.ts`).

### assertCharacterOwnership(characterId: bigint, userId: number): Promise<boolean>
True iff the character belongs to `userId` **and** is `status='active'`. Single source of truth for the character-ownership authorization check; reused by `setCharacterTrackingAction` (and any future per-character account action).

---

### AccountCharacter (type)
`{ id: string; name: string; status; authzLevel }` — the display-safe shape returned by `getAccountCharacters`.

### Notes
- `server-only` import guard — never bundled to the client.
