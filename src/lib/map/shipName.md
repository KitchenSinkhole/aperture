## shipName.ts

**Purpose:** Resolve a pilot's custom hull name from a presence entry.
**File:** `src/lib/map/shipName.ts`

Pure and dependency-free, so both the authed roster tables and the public spectator view can use it without either reaching into the other's component tree.

---

### type ShipNamed
`{ shipName: string | null; shipTypeName: string | null }` — the structural subset any presence-entry shape must satisfy. Both `MapPresenceEntry` and `PublicPresencePilot` do.

---

### customShipName(p: ShipNamed): string
The pilot's custom hull name, or `''` when the hull is un-renamed — ESI defaults `ship_name` to the ship type, so an equal pair means "no custom name".
