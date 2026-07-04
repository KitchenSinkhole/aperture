## route.ts — GET /api/reference/wormholes

**Purpose:** Returns the full wormhole jump reference catalog for the Jump Info dialog.
**File:** `src/app/api/reference/wormholes/route.ts`

### GET
**Query params:** none.

**Response:** `{ ok: true, data: WormholeJumpInfoRow[] }` — each row carries `{ typeId, code, sourceClasses, targetClass, totalMass, jumpMass, lifetimeMinutes, sigStrength }` (`sourceClasses` is a `string[] | null`), ordered by code. Static reference data sourced from `wormholeJumpInfo()` (`universe_wormhole` + dogma attributes); not map-scoped.

**Responses:** 200 ok, 401 unauthenticated (no signed-in character).
