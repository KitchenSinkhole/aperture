## SetupPage

**Purpose:** Operator console at `/setup`. Renders the unlock form when locked; renders trigger cards + a status panel when unlocked.
**File:** `src/app/(setup)/setup/page.tsx`

### Renders
- **Locked:** heading + `SetupUnlockForm`.
- **Unlocked:** heading + a `Lock` form (logout button), four top cards (`RunMigrationsCard`, `RunSdeRefreshCard` — advance to CCP's latest published build, `RunSdeIngestCard` — re-ingest the pinned `SDE_BUILD`, `RunCsvIngestCard` — the vendored wormhole CSVs only), the `SdeStatePanel` (the full `ap_sde_state` row), the `InstanceAccessPanel` (access mode + owners + allowlist/grants), a per-task grid of `RunCronCard`s for the on-demand job subset (`onDemandJobModules()` — cron-driven, payload-less tasks only; `location-poll` / `webhook-dispatch` are excluded because they require a payload), and a `StatusPanel` showing recent `ap_job_run` rows + the latest applied migration `created_at` + the count of `ap_map_event` rows in the last hour. Each trigger is its own client wrapper around `SetupCard` so the page (a server component) doesn't pass any function props across the server/client boundary.

### Behaviour & Interactions
- Server component; reads `readSetupCookie()` to branch locked vs unlocked.
- `export const dynamic = 'force-dynamic'` — the page reads cookies + live DB state on every visit.
- Logout is a single-field `<form action={setupLogoutAction}>` so it works without JS.
- Each `SetupCard` is a client component that wraps the action in `useTransition` and toasts the outcome.

### Emits / Calls
- `setupLogoutAction` — Lock button (inline server-action wrapper so the `<form>` signature matches).
- Trigger client components own their own Server Action calls: [[RunMigrationsCard]], [[RunSdeRefreshCard]], [[RunSdeIngestCard]], [[RunCsvIngestCard]], [[RunCronCard]].
- `loadSdeState()` reads the `ap_sde_state` singleton for `SdeStatePanel`, which renders the operator-only detail the banner omits: current and latest build with release dates, check/refresh/behind-since timestamps, consecutive failures, the last failure reason, retained orphan counts per table, and uncataloged wormhole codes. The two jsonb columns are narrowed defensively before display.
- `loadInstanceAccess()` reads `getInstanceConfig()` ([[instanceConfig]]) and serializes bigints→strings / dates→ISO into `SerializedInstanceConfig` for [[InstanceAccessPanel]].

### Notes
- The status panel queries `drizzle.__drizzle_migrations` and `ap_map_event` defensively (try/catch); on a fresh empty DB those tables may not exist yet.
- `loadSdeState()` and `loadInstanceAccess()` are likewise try/catch-guarded — before the permissions-overhaul migration runs, the `ap_instance`/`ap_access_grant` tables don't exist, so it falls back to a locked-down empty config until migrations are applied.
- `dynamic = 'force-dynamic'` because Next would otherwise try to statically render the locked state at build time and miss the cookie-gated branching.
