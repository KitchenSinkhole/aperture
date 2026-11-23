## zkb-feed.test.ts

**Purpose:** Unit coverage of the zKillboard live feed (`src/lib/integrations/zkbFeed.ts`) with `@/db/client` and the logger mocked and `fetch` stubbed.
**File:** `tests/unit/zkb-feed.test.ts`

### Covers
- `correlateKill`: one notification per active map watching the system; none for an unwatched system or a system-less kill.
- `pollOnce`: the live seed (no processing); walking from the cursor to a 404; a failed or malformed seed leaves the cursor null and re-seeds live, never from 0; the R2Z2 `esi`-nested shape notifies; a stale or undated kill is skipped with `zkb.stale_skipped` while a fresh one in the same tick notifies.
- Persistence: an on-map R2Z2 kill (`tests/fixtures/zkbR2z2.ts`) is inserted as a row whose body `killmailSchema` parses, without the `zkb` block; a stale on-map kill is persisted but not flashed; a body failing the schema and an entry with no hash are not persisted and still flash; an off-map kill is not persisted; a flat-shape entry is stored without its zKB fields and takes its hash from `zkb.hash`.
