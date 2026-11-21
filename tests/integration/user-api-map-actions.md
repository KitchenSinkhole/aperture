## user-api-map-actions.test.ts

**Purpose:** Drives the Map Settings → API tab's Server Actions (`src/app/(app)/actions/mapApi.ts`) against real Postgres.
**File:** `tests/integration/user-api-map-actions.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api-map-actions
```

Mocks `@/lib/session`'s `requireSession` (hoisted character and account, set via `actAs`). Snapshots the live `ap_instance` access mode and user API switch and restores them; the test corp is an instance owner, so its members pass the login gate and each refusal has one cause. Seeds a corp Director, a member with an alt on the same account, a title holder delegated `api_manage`, and an outsider in another corp. Ids use a 9737xxxx block.

### Covers
- `updateMapApiSettings` — a plain member is refused; a title-delegated holder enables the API as one `api.enabled`; a scope edit is one `api.scopes_changed` naming what was added and removed, and a no-op save commits nothing; a save turning the API off while changing scopes is refused, and a plain one is `api.disabled`. A record cached just before a switch flip or a scope removal sees the change on the next call (`invalidateUserApiMap`).
- `createMapApiToken` — minting from an alt stores the hash and prefix, commits `api.token_created` with the session character as actor, and lists the token on the account with the main as owner; the raw token, hash and prefix appear in no event payload and the raw token in no list. Refused while the map or the instance has the API off, from an alt that views the map when the account's main does not (the main moved to a corp that is also an instance owner, so `canViewMap` is the only cause) or when the stored main is not active, while the account is blocked, for an unexposed scope, at the per-map cap (expired and revoked tokens not counted) and at the per-account cap across maps.
- `revokeMapApiToken` — revoking your own token from an alt records `creator` and the actor, commits one `api.token_revoked` naming the main as owner, turns a cached allow into a 401 on the next call (`invalidateUserApiToken`), and is idempotent; someone else's token without `api_manage` answers exactly as an unknown id; an `api_manage` holder revokes it as `manager`.
- `getMapApiState` — a viewer gets only their own tokens and no manager list; a manager gets every token with `active`, `suspended`, `lost_access` and `blocked` statuses; a blocked account gets its block.
