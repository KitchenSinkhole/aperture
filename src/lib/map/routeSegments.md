## routeSegments.ts

**Purpose:** Group a computed route's flat hop list into the navigational runs a pilot would narrate (a gate burn, a chain traversal, a wormhole entry/exit) and render each as one instruction line.
**File:** `src/lib/map/routeSegments.ts`

Pure and DB-free — no `server-only` import, so the browser bundles it directly; `RoutePlannerModule` calls it on the plan it already holds and no new API surface is involved.

---

### routeSpaceKind(security: string \| null, name: string): RouteSpaceKind
Classifies a system's space from its `universe_system.security` label, with the `J######` name form as a fallback for a missing label.

`P` → `pochven`; `A` → `abyssal`; any `C<digits>` → `jspace` (Thera is `C12` and shattered systems are `C13`, so the pattern covers them); `H` / `L` / `0.0` → `kspace`; otherwise `unknown`. Turnur is genuine K-space despite being an EVE-Scout hub and is not special-cased.

**Returns:** one of `kspace` / `jspace` / `pochven` / `abyssal` / `unknown`.

---

### segmentRoute(plan: RoutePlan): RouteSegment[]
Groups `plan.hops` into segments, in travel order.

- Consecutive `gate` hops collapse into one **`gate_run`**, across security-band and region boundaries alike — a pilot burning to a hub reads that as a single instruction.
- Consecutive `wh` hops whose endpoints are both J-space collapse into a **`chain_run`**. Its entry sig is retained only while the run is one jump long; beyond that the segment reports endpoints and a count.
- Any other `wh` hop is its own **`wh_jump`**, with `direction` `enter` (into J-space), `exit` (out of J-space), or `lateral`.
- A `wh_jump(enter)` immediately followed by a `wh_jump(exit)` collapses into a **`wh_transit`**, carrying both sigs and the `through` system. Their adjacency *is* the "passed through exactly one J-space system" condition, so no length threshold exists.
- `jumpbridge` hops take their own single-hop segment and never fold into a neighbouring run.
- An `eve_scout` hop is its own segment, but two consecutive ones collapse into an **`eve_scout_transit`** through the hub they meet at. This merge keys on the edge kind, not the space either side: EVE-Scout serves exactly two hubs, and Thera is J-space (`C12`) while Turnur is lowsec K-space, so a space-based rule would fold one and not the other.
- A one-hop plan yields a single **`origin_only`** segment.

**Returns:** one segment per instruction; `[]` when the plan is unreachable. Segment index ranges tile `plan.hops` end to end — consecutive segments share a boundary index — so a renderer can map any hop back to the segment covering it.

---

### routeSegmentTokens(seg: RouteSegment): RouteInstructionToken[]
One segment as an ordered token list — the single source of the instruction wording, shared by the on-screen render and the clipboard text. Systems and sig codes are separate token kinds so the UI can tint a system by its map colour and set a sig code in mono; `text` tokens carry the connecting prose. An unscanned wormhole yields a `text` placeholder, not a `sig` token.

---

### formatRouteSegment(seg: RouteSegment): string
Concatenates `routeSegmentTokens` into a single plain-text instruction, e.g. `In Amarr, enter C5A via BSA, then exit to Jita via SOF.`

Every line opens by naming where the pilot currently is. A tagged J-space system is named by its class and tag together (`ap_map_system.tag` holds only the letter, so class `C1` + tag `B` reads `C1B`); an untagged one falls back to its `J######` name, and K-space is always named by its real system name. A wormhole with no signature recorded on the departure side reads `via an unscanned sig` rather than dropping the clause. Gate runs and chain runs of one jump get their own shorter phrasing (`gate to`, `follow the chain to … via …`).

---

### formatRouteInstructions(segments: RouteSegment[]): string
The whole route as a `Route <origin> -> <destination>` header line followed by one numbered step per line — the clipboard form, plain text ready to paste into in-game chat. `''` for an empty segment list.
