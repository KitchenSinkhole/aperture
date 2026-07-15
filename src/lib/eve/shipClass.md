## shipClass.ts

**Purpose:** Resolve a ship type to a broad `ShipClass` bucket for the pilot-presence icon.
**File:** `src/lib/eve/shipClass.ts`

Classification is keyed primarily by `universe_type.groupId` (`SHIP_GROUP_CLASS`) since CCP's SDE
groups ships by hull size/role — a new hull release lands in an existing group and classifies
correctly with no code change. `SHIP_TYPE_CLASS_OVERRIDES` is checked first, for the small set of
hulls whose SDE group doesn't match their in-game role label (Venture and Venture Consortium Issue
sit in the plain "Frigate" group; Outrider sits in "Command Destroyer" alongside five combat hulls
despite its "Mining Command Destroyer" in-game label; Pioneer, Perseverance, and Pioneer Consortium
Issue sit in the plain "Destroyer" group despite their "Mining Command Destroyer" in-game label).
`SHIP_GROUP_CLASS` covers every published Ship-category group as of SDE build 3351823, including
`Special Edition Yachts` bucketed as `cruiser`.

---

### resolveShipClass(typeId: number | null, groupId: number | null): ShipClass | null
Checks `SHIP_TYPE_CLASS_OVERRIDES[typeId]` first, then falls back to `SHIP_GROUP_CLASS[groupId]`.

**Returns:** The resolved `ShipClass`, or `null` when either id is `null` or unrecognized.

---

### SHIP_CLASS_LABELS: Record\<ShipClass, string\>
Human-readable label per `ShipClass` (e.g. `'mining-barge' → 'Mining Barge'`), for `alt` text.
