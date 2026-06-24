## shatteredSystems.ts

**Purpose:** Identifies shattered wormhole systems straight from the J-sig name — no hand-curated id set required.
**File:** `src/lib/eve/shatteredSystems.ts`

A shattered system has had its planets/moons destroyed (no anchorable celestials, a permanent system effect, frigate-size limits for the class-13 holes). CCP numbered every shattered J-space system in the `J0xxxxx` band (J000102 – J015227), so a leading `J0` is both necessary and sufficient to recognise one. Regular wormholes are named `J1xxxxx` and up; the five Drifter systems carry lore names (`Liberated Barbican`, …) and never match. Thera is the one shattered system without a J-sig and is matched by name.

---

### isShatteredSystem(name: string): boolean
Returns `true` if the system name is a shattered wormhole system: `Thera` or a name matching `/^J0\d{5}$/`. Used by the map node to render a shattered indicator. Display only — touches no stored data.
