## admin-maps.test.ts

**Purpose:** Drives the three admin map Server Actions end-to-end against a real Postgres and asserts: soft-delete flips `deleted_at` + emits one `map.delete`; restore clears `deleted_at` + emits one `map.restore`; purge hard-deletes the row and cascades its events; all three are global-admin-only (corp Director / member / anon denied).

**File:** `tests/integration/admin-maps.test.ts`

### Run
`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test admin-maps`

### Setup
- One `ap_user` (random pk), one corp (`CORP_A` with `ALLIANCE_A`), three characters:
  - `ADMIN_ID` — `authzLevel='admin'` in corp A (the global operator).
  - `DIRECTOR_ID` — `isDirector=true`, `authzLevel='member'` in corp A. Can manage corp-A maps in-place via `canManageMap`, but is NOT a global operator — proves the `/admin` actions are admin-only.
  - `MEMBER_A_ID` — default `authzLevel='member'` in corp A.
- Two corp-A maps re-created `beforeEach`: an active map and a soft-deleted map. The soft-delete is applied via a raw `UPDATE` so each test starts with the same state.

### Mocking
- `@/lib/auth` is mocked to `{ auth: vi.fn(async () => currentSession) }`; tests mutate `currentSession` to swap actors. Same idiom as `character-session.test.ts`.
- `next/cache.revalidatePath` is mocked to a no-op so the actions can call it without a Next bundler in scope.

### Covered cases
- `adminSoftDeleteMap`: success path, refusal on already-soft-deleted.
- `adminRestoreMap`: success path, refusal on non-soft-deleted.
- `adminPurgeMap`: success path (row gone + events cascaded), refusal on active map.
- Admin-only gate: a corp Director, a plain member, and an anonymous session are denied all three actions (and the Director-denial test confirms the maps are left untouched).
