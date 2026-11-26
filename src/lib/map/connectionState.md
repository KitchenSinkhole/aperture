## connectionState.ts

**Purpose:** Pure client-side helpers that derive a wormhole connection's expiry instant / time remaining from `eolStage` / `eolAt` / `createdAt` and the lifetime constants in `aperture.config.ts`. Drives the EOL countdown in `ConnectionDetailPopover` and the "Expires in X" inspector hint. Display-only: EOL branches use the in-game *nominal* lifetimes; the `eol-expiry` reap job runs on the longer nominal + grace-buffer thresholds via its own SQL, so a hole reads "expired" here slightly before it is purged.
**File:** `src/lib/map/connectionState.ts`

---

### connectionExpiresAt(c: ConnectionLifecycleInput): Date | null
Wall-clock instant the connection expires, or `null` when no expiry applies.

- Wormhole + `eolStage === 'critical'`: `eolAt + WORMHOLE_EOL_CRITICAL_NOMINAL_MS` (1h).
- Wormhole + `eolStage === 'eol'`: `eolAt + WORMHOLE_EOL_NOMINAL_MS` (4h).
- Wormhole + `eolStage === 'none'`: `createdAt + WORMHOLE_DEFAULT_LIFETIME_MS`.
- Wormhole + `eolStage === 'expired'`: `null` (the manual terminal stage has no timed expiry).
- Stargate / jumpbridge / abyssal: `null` (these connections never expire — the EOL state machine only applies to wormholes).
- EOL stage set but `eolAt` is null (stale-snapshot defence): `null`.

**Parameters:**
- `c` — a `Pick<MapConnectionEdge, 'scope' | 'eolStage' | 'eolAt' | 'createdAt'>`.

**Returns:** `Date` or `null`.

---

### eolTimeUrgencyFromMs(timeLeftMs): EolTimeUrgency | null
Live urgency for experimental EOL colouring: `warning` below the 4h nominal, `critical` at or below the 1h nominal or when the countdown has elapsed (`timeLeftMs <= 0`).

### eolDisplayUrgency(stage, timeLeftMs): EolTimeUrgency | null
Maps stored `eolStage` plus live countdown into outline/tag urgency (`expired` is always `critical`).

### formatEolTimeLeftTag(ms: number): string
Compact countdown for connection-edge EOL tags (e.g. `3h 42m`).

---

### connectionTimeLeftMs(c: ConnectionLifecycleInput, now?: number): number | null
Milliseconds until `connectionExpiresAt(c)`. Returns `null` for non-expiring connections and `0` once past expiry (clamped, never negative). `now` defaults to `Date.now()` but is injectable for tests.

---

### connectionExpiredSinceMs(c: ConnectionLifecycleInput, now?: number): number | null
Milliseconds since a wormhole was manually marked `expired`, measured from `eolAt`. Returns `null` for any other stage/scope or when the `expired` row has no `eolAt`. Drives the "Expired X ago" readout that replaces the countdown on an expired hole. `now` is injectable for tests.

---

### ConnectionLifecycleInput
Type alias for `Pick<MapConnectionEdge, 'scope' | 'eolStage' | 'eolAt' | 'createdAt'>` — the minimal shape the helpers consume.
