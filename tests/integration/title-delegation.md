## title-delegation.test.ts

**Purpose:** Drives the `mapRoles` Server Actions (per-title feature delegation, R4) end-to-end against real Postgres.
**File:** `tests/integration/title-delegation.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test title-delegation
```

Mocks `@/lib/session`'s `requireSession` (hoisted `actingCharacterId`, set via the `actAs` helper) so `getMapDelegationState` / `setMapDelegation` can be called as a specific character without a real Auth.js session.

### Covers
- `getMapDelegationState` — lists the owning corp's titles with empty grants (manager-gated, excludes a foreign corp's title); reports `available: false` on a non-corp map; forbidden for a non-manager.
- `setMapDelegation` — grants and revokes `audit_view` and `map_export`, each asserted to give the holder **exactly** that capability (via `hasMapCapability`) and nothing else; rejects the implicit `view` capability; rejects a forged `roleId` from another corp; forbidden for a non-manager.
- Each grant/revoke lands exactly one `access.granted` / `access.revoked` `ap_map_event`, and the grant event's audit-log row names the title and capability (`queryAuditEvents`).

Seeds two corps, a Director + a plain member (the member holding one of two `corp_title` roles on Corp A), and a corp map + a private map.
