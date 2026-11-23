## audit-actor-summary.test.ts

**Purpose:** Unit coverage for `auditActorSummary`'s kind-to-category bucketing and destructive count, over a mocked `@/db/client` that resolves canned `(kind, count)` rows.
**File:** `tests/unit/audit-actor-summary.test.ts`

No DB required. Asserts `share.*` and `api.*` kinds fall under the `access` category, and that `api.disabled`, `api.token_revoked` and `share.revoked` count toward `destructive`.
