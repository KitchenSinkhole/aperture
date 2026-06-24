## statistics.test.ts

**Purpose:** Drives `src/lib/stats/activity.ts` against real Postgres.
**File:** `tests/integration/statistics.test.ts`

Gated on `RUN_DB_TESTS=1` (skipped otherwise). Run:

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test statistics
```

### Covers
- `resolveStatsAccess` — tabs reflect corp/alliance membership; `null` session → `[]`.
- **Main-character rollup** — an alt's `signature.create` lands on the account main's row; the alt is not a separate row.
- **`map.*` excluded** — `map.create` does not count toward totals.
- **Period split** — a prior-week event appears in the sparkline `series` (sum) but not the current-period triplet (`series.at(-1)` = current total).
- **Unknown bucket** — a null-character event becomes the `'0'` / `'(unknown)'` row.
- **Scope visibility** — corp stats exclude another corp's map; outsider activity never leaks.
- `hasNext` is false when anchored to the current period.

Seeds two accounts (main+alt, outsider), three maps (private / own-corp / other-corp), inserts `ap_map_event` rows across the current and prior week, then `REFRESH MATERIALIZED VIEW ap_activity_rollup` before asserting.
