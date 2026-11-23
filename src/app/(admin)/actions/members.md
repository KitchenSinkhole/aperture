## members.ts (admin server actions)

**Purpose:** Admin moderation actions: `kick` / `ban` / `activate` on `ap_character` rows (direct `ap_character.status` writes), and the user API account block and lift on the character's `ap_user`. All gated by `isAdmin` (global operator only); corp Directors carry map authority but cannot moderate.
**File:** `src/app/(admin)/actions/members.ts`

---

### adminKickCharacter(characterId: string, minutes: 5 | 60 | 1440, reason?: string): Promise<ActionResult>
Sets `status='kicked'`, `status_expires_at = now() + minutes`, `status_reason = reason ?? null`, `status_changed_at = now()`. The `character-cleanup` cron (`src/lib/jobs/tasks/characterCleanup.ts`) handles the eventual flip back to `'active'`. Three durations only — 5, 60, 1440 minutes.

### adminBanCharacter(characterId: string, reason: string): Promise<ActionResult>
Sets `status='banned'`, `status_expires_at = null`, `status_reason = reason`, `status_changed_at = now()`. `reason` is required (1-500 chars). Bans never auto-clear — `clearKickExpiries` in the cron filters on `status='kicked'`.

### adminActivateCharacter(characterId: string): Promise<ActionResult>
Clears any moderation state. Sets `status='active'` and NULLs `status_expires_at` / `status_reason`. Works on both kicked and banned rows.

### adminBlockUserApi(characterId: string, reason: string): Promise<ActionResult>
Blocks the user API for the whole account the character belongs to, until an admin lifts it: `api_blocked_at = now`, `api_blocked_until = null`, `api_block_reason = reason`. `reason` is required (1-500 chars, trimmed) and is shown to the account. While blocked the account cannot mint and every token it owns answers `account_blocked`. Blocking an already-blocked account restarts the block as indefinite.

### adminLiftUserApiBlock(characterId: string): Promise<ActionResult>
Ends the account's standing block, timed or indefinite, by setting `api_blocked_until = now`. `api_blocked_at` is kept, since the repeat-offence window reads it. Returns `"This account has no API block."` when no block stands.

Both API actions write with the app clock (the clock the block is evaluated against) and call `invalidateUserApiAccount(userId)` after the write commits, so the account's tokens see the change on the very next request.

---

### Gating

All five actions require `isAdmin` (global deployment operator). A missing target returns `"Character not found."`. There is no corp-scoped moderation tier any more — the `manager` authz level and the `grantManager` / `revokeManager` toggles were removed in the Stage-4 teardown (migration 0041).

### Audit

These actions write no DB-level audit row (`ap_map_event` is map-scoped, so character moderation and account API blocks are out of its scope). API block and lift are logged at `warn` through the structured logger.

### Depends on
- `auth`, `isAdmin` — `@/lib/auth/rights`.
- `apCharacter`, `apUser` — `@/db/schema`.
- `invalidateUserApiAccount` — `@/lib/userApi/authorize`; `getLogger` — `@/lib/log/logger`.
