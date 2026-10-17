## blackout.ts

**Purpose:** The one seam every presence egress asks about Blackout: is it on, is this account cleared, and is this pilot hidden from this viewer.
**File:** `src/lib/auth/blackout.ts`

No `import 'server-only'`: reached from `wsServer.ts` and the location-poll job runner, which load under plain Node.

---

### getBlackoutState(): Promise<BlackoutState>
Reads `ap_instance.blackout_since` / `blackout_by_character_id`. `active` is `since !== null`. A missing singleton row reads as off.

**Returns:** `{ active, since, byCharacterId }`.

---

### isBlackoutCleared(userId: number): Promise<boolean>
Whether the account sees pilots during a Blackout. True when any of the account's `active` characters:
- has `authz_level='admin'` (global admins are implicitly cleared), or
- holds an unexpired instance-scoped `blackout_view` grant by name (`principal_kind='character'`), or
- holds a title (`ap_character_role`) carrying an unexpired `blackout_view` grant (`principal_kind='role'`).

Kicked and banned characters never count, so neither their grants nor their titles clear the account. Clearance is per account: a grant on one character clears every character on it. Directors are not implicitly cleared. Independent of whether Blackout is on.

**Parameters:**
- `userId` — the viewer's `ap_user.id`.

---

### isBlackedOut(viewer: Pick<BlackoutViewer, 'active' | 'cleared'>): boolean
`active && !cleared`: Blackout restricts what this viewer sees. The gate for surfaces hidden wholesale (mass log, audit actors).

---

### isPilotHidden(viewer: BlackoutViewer, pilotUserId: number): boolean
The presence rule: true when `isBlackedOut(viewer)` and the pilot's account is not the viewer's. A viewer always sees their own account's pilots.

---

### Depends On
- Schema: `ap_instance` (switch), `ap_access_grant` (`blackout_view` grants), `ap_character` (account membership, status, `authz_level`), `ap_character_role` (title membership).
- Types: `BlackoutState`, `BlackoutViewer` (`src/types/index.ts`).
