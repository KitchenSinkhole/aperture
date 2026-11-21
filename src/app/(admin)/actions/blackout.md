## blackout.ts (admin server actions)

**Purpose:** Global-admin actions for Blackout at `/admin/settings`: the instance-wide switch on `ap_instance` and the cleared list of `blackout_view` grants.
**File:** `src/app/(admin)/actions/blackout.ts`

Every action is gated by `isAdmin` and returns `{ ok: false, error: 'Forbidden.' }` to anyone else. Each mutation commits in one transaction with a `pg_notify` on `apertureConfig.INSTANCE_NOTIFY_CHANNEL` (empty payload), so the notify is delivered only once the change is visible, then revalidates `/admin/settings`. A refused mutation emits nothing.

---

### adminStartBlackout(): Promise<ActionResult>
Turns Blackout on: sets `blackout_since = now()` and `blackout_by_character_id` to the acting admin, creating the `ap_instance` singleton if it is missing. Already on, the original start time and admin are kept.
Then clears every cached public share snapshot (`clearPublicSnapshots`), so a `/live` link never serves presence read before the switch.

---

### adminEndBlackout(): Promise<ActionResult>
Turns Blackout off: clears `blackout_since` and `blackout_by_character_id`, then clears every cached public share snapshot.

---

### adminAddBlackoutClearance({ principalKind, principalId, expiresAt, note }): Promise<ActionResult>
Adds an instance-scoped `blackout_view` grant, recording the acting admin as `granted_by_character_id`. Re-adding a principal already on the list replaces its expiry and note.

**Parameters:**
- `principalKind` — `'character'` or `'role'`; anything else (corporation, alliance) is rejected.
- `principalId` — digit string: an `ap_character.id`, or the `ap_role.id` of a `corp_title` role. An id naming neither is rejected.
- `expiresAt` — an ISO instant, or `''` for permanent. Must be in the future.
- `note` — up to 500 chars; `''` stores NULL.

---

### adminRemoveBlackoutClearance(grantId: string): Promise<ActionResult>
Deletes one cleared-list entry. Only `scope='instance'`, `capability='blackout_view'` rows are removable; any other id (a `login` / `admin` grant, an unknown id) returns `Not a cleared-list entry.` and deletes nothing.

---

### adminLoadBlackoutPanel(): Promise<ActionResult<BlackoutPanelData>>
Everything the panel renders: the switch state and the name of the admin who turned it on, the cleared list (expired entries included, flagged `expired` against the DB clock) with each principal's character name or title label and a title's corp, every `active` character for the by-name picker, and every `corp_title` role with its corp for the title picker.

---

### Depends on
- `auth`, `isAdmin` — `@/lib/auth/rights`.
- Schema: `ap_instance`, `ap_access_grant`, `ap_character`, `ap_role`, `ap_corporation`.
- `apertureConfig.INSTANCE_NOTIFY_CHANNEL`.
- `clearPublicSnapshots` — `@/lib/map/publicSnapshot`.
- Types: `BlackoutPanelData` (`src/types/index.ts`).
