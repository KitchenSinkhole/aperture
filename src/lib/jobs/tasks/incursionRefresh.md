## incursionRefresh.ts

**Purpose:** Refreshes the active-incursion feed from ESI.
**File:** `src/lib/jobs/tasks/incursionRefresh.ts`

---

### incursionRefresh
Graphile-worker job module named `incursion-refresh`, scheduled every 5 minutes (matching ESI's `/incursions/` cache), with `maxAttempts: 1` — each run is a full replace of the current snapshot, so the next tick supersedes a failed one entirely.

Fetches `getIncursions` through `esiCall`, full-replaces `universe_incursion` in a transaction (active incursions are few and short-lived; withdrawing ones just drop out of the payload), then warms the name cache for the incursion faction ids via `resolveStaleEntityNames`. Returns `{ fetched, infestedSystems }` notes for `ap_job_run`.
