## sde-status.test.ts

**Purpose:** Table-driven unit coverage of `getSdeStatus` — the single derivation of static-data health behind both the `(app)` layout banner and `GET /api/sde-status`.
**File:** `tests/unit/sde-status.test.ts`

### Running
No database. `@/db/client` is mocked with a thenable query builder resolving to one controllable `ap_sde_state` row (or none), so every state in the matrix is reachable without touching Postgres.

```
pnpm test sde-status
```

### Cases
The matrix walks the state row through:
- No row at all: `stale`, with null builds and null `checked_at`.
- Converged builds, recently checked: `ok`.
- The gap clock: `behind_since` inside `SDE_STALE_GRACE_HOURS` is `ok`, past it is `stale`.
- The check clock: no check or ingest inside `SDE_CHECK_STALE_HOURS` is `stale`; the clock runs from the later of `checked_at` and `refreshed_at`, so a freshly bootstrapped deployment that has never checked is not stale.
- `failing` precedence: a failure while behind wins over both `ok` and `stale`; a failure once the builds converge is history and does not surface.
- A null `current_build`, which cannot be behind anything and so falls through to the check clock.

### Depends On
- `getSdeStatus` (`@/lib/sde/status`), `ApSdeState` (`@/types`), `apertureConfig` thresholds (real values, not stubbed).
