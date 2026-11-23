## health-probe.test.ts

**Purpose:** Unit tests for the `realtimeBus` component of `deepHealth` (`src/lib/health/probe.ts`), with the bus, pool, worker query and ESI breakers mocked.
**File:** `tests/unit/health-probe.test.ts`

### Covers
- `ok` while the LISTEN connection is live, and when the bus is disconnected with no map subscriber and no instance listener.
- `degraded` when the connection is down and either map subscribers or only an instance listener exist.
