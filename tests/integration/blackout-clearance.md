## blackout-clearance.test.ts

**Purpose:** Drives `isBlackoutCleared` / `getBlackoutState` (`src/lib/auth/blackout.ts`) and the cleared-list CHECKs against real Postgres.
**File:** `tests/integration/blackout-clearance.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test blackout-clearance
```

Snapshots the live `ap_instance` singleton (access mode and the Blackout switch) in `beforeAll` and restores it in `afterAll`. Seeds ids in the `9721xxxx` block.

### Covers
- `isBlackoutCleared` — clears an admin's account, every character on an account with a by-name grant, and a title holder's account; ignores expired by-name and title grants, a kicked character's by-name grant and a banned character's title (each on an account that also has an active, ungranted character); does not clear an unrelated account.
- `ap_access_grant_blackout_principal_chk` — rejects `blackout_view` on a `corporation` or `alliance` principal; a corporation `login` grant still inserts.
- Login gate — under `restricted` with an owner seeded, a character whose only grant is `blackout_view` is not admitted.
- `getBlackoutState` — off while `blackout_since` is NULL; on with `since` / `byCharacterId` when set; still on with `byCharacterId: null` after that character is deleted.
