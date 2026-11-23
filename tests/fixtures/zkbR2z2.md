## zkbR2z2.ts

**Purpose:** Test fixture factory for one zKillboard R2Z2 ephemeral feed entry.
**File:** `tests/fixtures/zkbR2z2.ts`

---

### r2z2Kill(overrides?): object
One feed entry in the R2Z2 shape: the ESI killmail under `esi` (with `solar_system_id`, a victim with ship type, character and corporation ids, and two attackers, so it satisfies `killmailSchema`), `hash` at the top level, and `zkb.totalValue` alongside. Defaults are killmail 555 in Jita (30000142), a Rifter (587), killed now, worth 8M ISK.

**Parameters:**
- `overrides` — any of `killmailId`, `systemId`, `killmailTime` (ISO), `shipTypeId`, `hash`, `totalValue`.

### Used By
- `tests/unit/zkb-feed.test.ts`, `tests/db/zkb-feed-persist.test.ts`.
