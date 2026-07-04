## wormholeFormat.ts

**Purpose:** Display formatters for wormhole mass / lifetime reference values, shared across the Jump Info dialog, the connection mass-log, and the connection detail popover.
**File:** `src/lib/eve/wormholeFormat.ts`

---

### formatWormholeMass(kg: number | null): string
Kilograms → kilotonnes string (`1 kt = 1e6 kg`), thousands-separated, e.g. `3,000 kt`. `null` → `—`.

---

### formatWormholeLifetime(minutes: number | null): string
Minutes → whole-hour string, e.g. `24h`. `null` → `—`.
