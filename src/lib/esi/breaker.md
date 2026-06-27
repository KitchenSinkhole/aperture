## breaker.ts

**Purpose:** Per-endpoint (keyed by OpenAPI `operationId`) circuit breaker so the ESI client stops hammering a failing endpoint. In-process `Map`, no shared store (no Redis).
**File:** `src/lib/esi/breaker.ts`

States: `closed → open` after `ESI_BREAKER_FAILURE_THRESHOLD` consecutive failures; `open → half-open` after `ESI_BREAKER_COOLDOWN_MS`; `half-open → closed` on success or `→ open` on failure. Downtime failures must be excluded by the caller (never call `recordFailure` in the downtime window).

---

### canRequest(operationId: string): boolean
True when closed/half-open. An open breaker whose cooldown elapsed transitions to half-open here (admitting one trial) and returns true; still-cooling open returns false.

### recordSuccess(operationId: string): void
Closes the breaker, resets the consecutive-failure run.

### recordFailure(operationId: string): void
Increments the failure run. Re-opens immediately on a half-open trial failure; otherwise opens once the threshold is reached. Sets the cooldown deadline.

### breakerState(operationId: string): BreakerState
Current state (`closed | open | half-open`) — observability/tests.

### openBreakerCount(): number
How many breakers are currently `open`, counted without mutating state (a cooled-down open breaker is **not** transitioned to half-open here, unlike `canRequest`). Used by the health probe (`esi` component) / metrics.

### __resetBreakersForTest(): void
Clears all breaker state.

### BreakerState
`'closed' | 'open' | 'half-open'`.
