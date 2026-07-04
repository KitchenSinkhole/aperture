## WormholeReferenceRows

**Purpose:** Shared popup body for a wormhole's static routing data — the header line plus the mass/lifetime rows rendered by both the connection and static detail popovers.
**File:** `src/components/map/WormholeDetailRows.tsx`

### Exports

#### WormholeReferenceRows({ code, sizeClass, reference })
Renders a header line — the wormhole code (`code` or `unknown`), the size band (`sizeClass` uppercased) and the leads-to class (`reference.targetClass`) coloured by `systemClassColor` — followed, when `reference` is present, by Total mass / Max jump / Max lifetime rows.

**Props:**
- `code` — resolved wormhole code (e.g. "B274"); null renders `unknown`.
- `sizeClass` — `WhJumpMass | null`; the connection variant passes the connection's stored class, the static variant derives it from the reference `jumpMass` via `jumpMassBand`. Null omits the size chip.
- `reference` — `WormholeJumpInfoRow | null`; null omits the mass/lifetime rows (header only).

#### Row({ label, value })
A single label/value line (muted label left, tabular-nums value right). Used for the reference rows here and appended rows in the connection popover (mass logged).

### Depends On
- `@/lib/eve/wormholeFormat` (`formatWormholeMass`, `formatWormholeLifetime`).
- `./styling` (`systemClassColor`) for the leads-to class colour.
