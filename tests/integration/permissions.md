## permissions.test.ts

**Purpose:** Drives the rights model (`src/lib/auth/rights.ts`) end-to-end against real Postgres.
**File:** `tests/integration/permissions.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test permissions
```

Mocks `@/lib/session`'s `requireSession` (hoisted `actingCharacterId`, set via the `actAs` helper) so the one test that drives a Server Action end-to-end (`updateMapSettingsAction`) doesn't need a real Auth.js session; every other test calls `rights.ts` functions directly with an explicit characterId/session argument.

### Covers
- **View rule** — private/corp/alliance owner match, the role overlay, and that a kicked character fails every check.
- **Mutate rule** — `map_update` open to every viewer (content editing); `map_delete` and the rest gated by `canManageMap`.
- **`canManageMap`** — the derived-authority truth table (owner, owning-corp Director, executor-corp Director, admin) that a manager's implicit hold of every capability rests on; a plain viewing member cannot manage.
- **Per-title feature delegation (R4)** — `hasMapCapability`, `canUseMapFeature`, `resolveMapCapabilities`, `requireMapCapability`'s 401/403/404 shape.
- **`mapsWithCapability` agrees with per-id `canUseMapFeature`** across every actor (admin, owner, corp member, corp Director, outsider, alliance pilot, role holder) × every fixture map (private, corp, alliance, role-scoped) × a spread of capabilities (`view`, `audit_view`, `settings_manage`, `map_delete`).
- **`updateMapSettingsAction`** — a plain corp member who can view the corp map gets `Forbidden.` trying to save the General tab: viewing a map never implies renaming it.
- `canCreateMap`, `isAdmin`, `listViewableMaps` matching the per-check results.
- `character-cleanup` cron expiring past kicks and leaving bans alone.

Seeds two corps (one the executor of an alliance), two alliances, and eight characters covering every permission lane (admin, owner, corp member, corp Director, outsider, alliance pilot, kicked, role holder) against four maps (private, corp, alliance, role-scoped-private with a `view` + `audit_view` grant via a mirrored `corp_title` role).
