## connectionState.ts

**Purpose:** Pure client-side helpers that derive a wormhole connection's expiry instant / time remaining from `eolStage` / `eolAt` / `createdAt` and the lifetime constants in `aperture.config.ts`. Drives the EOL countdown in `ConnectionDetailPopover` and the "Expires in X" inspector hint. Display-only: EOL branches use the in-game *nominal* lifetimes; the `eol-expiry` reap job runs on the longer nominal + grace-buffer thresholds via its own SQL, so a hole reads "expired" here slightly before it is purged.
**File:** `src/lib/map/connectionState.ts`

---

### connectionExpiresAt(c: ConnectionLifecycleInput): Date | null
Wall-clock instant the connection expires, or `null` when no expiry applies.

- Wormhole + `eolStage === 'critical'`: `eolAt + WORMHOLE_EOL_CRITICAL_NOMINAL_MS` (1h).
- Wormhole + `eolStage === 'eol'`: `eolAt + WORMHOLE_EOL_NOMINAL_MS` (4h).
- Wormhole + `eolStage === 'none'`: `createdAt + WORMHOLE_DEFAULT_LIFETIME_MS`.
- Stargate / jumpbridge / abyssal: `null` (these connections never expire — the EOL state machine only applies to wormholes).
- EOL stage set but `eolAt` is null (stale-snapshot defence): `null`.

**Parameters:**
- `c` — a `Pick<MapConnectionEdge, 'scope' | 'eolStage' | 'eolAt' | 'createdAt'>`.

**Returns:** `Date` or `null`.

---

### connectionTimeLeftMs(c: ConnectionLifecycleInput, now?: number): number | null
Milliseconds until `connectionExpiresAt(c)`. Returns `null` for non-expiring connections and `0` once past expiry (clamped, never negative). `now` defaults to `Date.now()` but is injectable for tests.

---

### ConnectionLifecycleInput
Type alias for `Pick<MapConnectionEdge, 'scope' | 'eolStage' | 'eolAt' | 'createdAt'>` — the minimal shape the helpers consume.
