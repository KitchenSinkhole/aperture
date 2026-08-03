# Public Map Spectator Polish

**Goal:** Make the spectator view readable by someone who has never used Aperture: sig codes attributable to a system at a glance, a chain-entry board that gives turn-by-turn directions rather than a door, and page chrome sized for an audience instead of an operator.

**References:**
- `src/components/public/SpectatorView.md`, `SpectatorMap.md`, `PublicConnectionEdge.md`, `PublicSystemNode.md`, `EntrancesBoard.md`, `IntroCard.md`, `PromoBar.md`
- `src/lib/map/publicEntrances.md` (`derivePublicEntrances`, `leadsHome` BFS)
- `docs/plans/edge-face-fan.md` (**Stage 1 below is blocked on its Stage 3**)
- `src/app/globals.css` lines 170 to 210 (`--spec-*` tokens, `spec-row-in` / `spec-pulse` keyframes)
- CLAUDE.md: no backwards-compatibility shims; comments carry non-obvious *why* only

**Prerequisites the user must supply:**
- An Aperture logo as SVG or an icon component. Only `public/aperture logo.png` exists, and a PNG will look soft at 20 px on a retina display.
- The official Discord invite URL. `apertureConfig.PUBLIC_LINKS` (aperture.config.ts:503) currently holds only `repo`.

---

## Background: what is wrong now

**Sig tags are unattributable on short holes.** `tagPosition` (`PublicConnectionEdge.tsx:88`) separates the two tags on two axes at once: an along-edge offset capped at `gap * 0.35`, and a perpendicular offset of `±15` px via `perpSign`. Measured on the test map:

| Hole | Face gap | Along separation | Perpendicular separation |
|---|---|---|---|
| Isutaka to J160941 | ~47 px | ~14 px | 30 px |
| J103400 to Isutaka | ~58 px | ~18 px | 30 px |

The dominant axis of separation is the one carrying no meaning, so the pair reads as a stack floating in the gap, and both tags sit closer to each other than either does to its own node. The opposite `perpSign` is the design error: it converts a length shortfall into an ambiguity.

**Hover is the only way in, and most of this page's audience cannot hover.** The share link is built for stream overlays and Discord pastes. Sig codes, the most actionable thing on the canvas, are behind a gesture unavailable on touch entirely.

**The board undersells itself.** `EntrancesBoard` is the page's thesis (its own header comment says it "leads rather than sitting in a sidebar") and it renders in a 19 rem rail behind a 10 px eyebrow. On the test map four of six rows read `SCAN —`, so a row you can act on looks identical to one you cannot. The `→ C6 RST` cluster shows the *return* sig with no label, immediately after telling the reader to scan a different code.

**Chrome is sized for an operator.** The `PromoBar` nav links are 12 px in `--spec-dim` on `--spec-field`, which I estimate at roughly 3.7:1 and therefore under the 4.5:1 AA floor (worth measuring properly rather than trusting an oklch-to-sRGB approximation). These two links are the entire conversion path and they are styled as fine print.

**Deliberately not changing:** the green connection strokes. They carry which-system-connects-to-which, which is the map's whole content.

---

## Stage 1: sig tags hug their node

**Mode:** Plan mode
**Blocked on:** `docs/plans/edge-face-fan.md` Stage 3. Without per-connection attachment points, several tags on one face land on top of each other.
**Touches:** `src/components/public/PublicConnectionEdge.tsx` + `.md`, `src/components/public/PublicSystemNode.tsx` + `.md`, `src/components/public/SpectatorMap.tsx` + `.md`
**Goal:** A sig tag is attributable to one system and one connection without tracing a line, at any hole length.

**Placement.** Derive position from the node's bounding box, not the edge midline: flush against the face the edge attaches to, centred on that connection's own fanned attachment point, overlapping the tile's outer border by a few px so it reads as a tab clipped to the tile. Delete `SIG_TAG_ALONG_PX`, `SIG_TAG_PERP_PX`, `SIG_TAG_ALONG_MAX_SHARE` and the `perpSign` parameter. Adjacency replaces relative distance, which fixes long holes too: a tag currently floats 26 px into empty canvas and still has to be traced back.

**Collision relief.** Where a short gap cannot fit two tags between the tiles, offset each tag perpendicular to the line. This is safe now in a way it is not today, because each tag still touches its own node, so adjacency outranks the perpendicular split.

**Second cue.** Tint the tag with the *far* system's class colour via `systemClassColor`. A tag on J160941's face in C1 blue reads as "the code for the hole to the blue system", independent of position entirely, and it reuses the palette already on the tile stripe and the board rows.

**Reciprocal highlight (the second half of the fix).** Hovering a hole currently produces two chips and nothing else. Ring both endpoint tiles for the duration. `PublicSystemNode` already has the `highlighted` box-shadow treatment used by board hover; reuse it rather than inventing a second highlight language. This needs edge hover state to reach the nodes, which is the same wiring Stage 4 needs for route highlighting, so design the shared state here and let Stage 4 widen it from "one connection" to "a set of connections".

**Also fix:** `SigTag` sets `title` on a `pointer-events-none` element (`PublicConnectionEdge.tsx:259`), so the "This side has not been scanned" tooltip can never fire. Either make the tag a real hover target or drop the dead attribute.

**Open:** whether tags render persistently above a zoom threshold rather than on hover. Persistent rendering is what actually serves the stream-overlay audience, and the face fan makes it survivable, but it is a content decision with a legibility cost on a dense chain. Decide it by looking at a real chain with tags forced on, not in the abstract. If persistent, non-hovered tags must drop in contrast so the hovered pair still reads as selected.

**Done when:** on the test map, every hole from the 47 px Isutaka pair to the longest diagonal shows two tags each unmistakably belonging to one tile, both endpoint tiles ring on hover, and `ci-verifier` is green.

---

## Stage 2: chrome and type scale

**Mode:** Accept edits
**Touches:** `src/components/public/SpectatorMap.tsx` + `.md`, `SpectatorView.tsx` + `.md`, `PromoBar.tsx` + `.md`, `IntroCard.tsx` + `.md`, `aperture.config.ts`
**Goal:** The page reads as a finished product to a first-time visitor, and the way to learn more is obvious.

Mechanical against this spec, with no design unknowns except the two supplied assets.

**Canvas controls to bottom-right** (`SpectatorMap.tsx:103`). `IntroCard` is currently `absolute bottom-4 right-4` (`SpectatorView.tsx:54`) and is a `max-w-sm` card, so it would bury them on a first visit. **Move `IntroCard` to bottom-left**; it is transient and dismissable, the controls are permanent.

**Logo replaces the pulsing dot** in `PromoBar`. This also resolves liveness being split across both ends of the page: the header becomes pure identity, and the footer's `LIVE · Ns ago` becomes the sole liveness signal. Because it is now the only one, **the footer strip needs more presence** than 11 px in `--spec-dim`, and it keeps the animated dot.

**Nav hierarchy.** Three equally weighted dim links is the current problem; three equally weighted bright links is the same problem louder. Split them:
- **Open Aperture**: a real button, around 14 px, `spec-text` on `spec-rail` with a `spec-line` border. One primary action.
- **Discord** and **Source**: text links at around 13 px in full `spec-text`, not dim.

Add `discord` to `PUBLIC_LINKS` alongside `repo`.

**Type scale generally.** Raise the floor across the board. The 10 px eyebrows, the 11 px footer and the 12 px nav are operator-density sizes on a page whose audience is watching a stream. Keep the mono; only the scale changes.

**Done when:** the controls are clear of the intro card, the header carries the logo, the footer owns liveness, "Open Aperture" reads as the primary action, all three links clear AA against `--spec-field` (measured, not estimated), and `ci-verifier` is green.

---

## Stage 3: the entrances board becomes directions

**Mode:** Plan mode
**Touches:** `src/lib/map/publicEntrances.ts` + `.md`, `src/types/index.ts`, `src/components/public/EntrancesBoard.tsx` + `.md`
**Goal:** A guest with no map access can read one row and know the whole way in, hop by hop.

**The data is already computed and discarded.** `leadsHome` runs a BFS from the far endpoint with the entrance's own k-space system excluded from the graph. Keeping predecessors and reconstructing the path gives the hop list nearly free. Extend `PublicMapEntrance` with the route into the chain: per hop, the connection id, the sig code to scan in the system you are standing in, and the arrival system's name and security label.

Note this is a **different** field from the existing `route`, which is the k-space gate path to a trade hub. Name it so the two are not confusable.

**Sort home-leading entrances to the top**, under an explicit "Ways to home" heading, with everything else under "Other entrances". The gold left border then reinforces the grouping instead of carrying it alone. Secondary sort within each group stays nearest-hub-first, which is the existing order from `derivePublicEntrances`.

This also dissolves the duplicate-row problem without grouping by system. Two `Isutaka` rows stop reading as a render bug because they stop being duplicates: one carries a route home, the other does not.

**Row shape.** Prefer turn-by-turn over a compressed arrow chain:

```
Isutaka                                    H
3 jumps from Jita
  UVW  →  C6  J205141
  XYZ  →  C5  J100759
  BCD  →  ⌂   J160941
```

It names the system you should arrive in at each hop, so a pilot can confirm they are on track rather than guessing, and each line maps one-to-one onto an edge lighting up on the canvas in Stage 4. Colour each hop's class label with `systemClassColor`, so one row carries route, sigs and class sequence with no extra ink.

The vertical cost lands only on home rows; other entrances stay one line. That asymmetry is correct, because the two groups are genuinely different content.

**Drop the `→ C6 RST` cluster.** `RST` is the return sig, shown unlabelled immediately after instructing the reader to scan `UVW`. It is not actionable for a guest getting in, and anyone who needs it is looking at the map itself. The destination class survives inside the route lines.

**Three cases to design, not discover:**
- **Long routes.** Five or more hops will wrap or push other entrances off screen. Cap visible hops and collapse the middle, with the final hop into home always shown.
- **Redacted codes.** When the token withholds sig ids, every hop shows a dash and the row degrades to a system-name path. Still useful, but the "scan" framing stops making sense and the row should say something else.
- **Unscanned middle hops.** `UVW → — → BCD` is honest and genuinely informative ("you will have to probe that one yourself"). Keep those routes visible; do not filter them out.

**Done when:** home routes render turn-by-turn with per-hop class colour, the two groups are headed and sorted, `farSigId` no longer renders, all three cases above are handled, and `ci-verifier` is green.

---

## Stage 4: route highlight and touch

**Mode:** Accept edits
**Blocked on:** Stages 1 and 3.
**Touches:** `src/components/public/SpectatorView.tsx` + `.md`, `EntrancesBoard.tsx` + `.md`, `SpectatorMap.tsx` + `.md`, `PublicSystemNode.tsx` + `.md`, `PublicConnectionEdge.tsx` + `.md`
**Goal:** Hovering an entrance lights the whole path into the chain, sig tags included. This is the page's signature interaction.

Widen `highlightedSystemId: string | null` (`SpectatorView.tsx:23`) into a highlighted-route value carrying both system ids and connection ids. Nodes on the route ring, connections on the route lift, and every sig tag along it renders. Reuse the hover state designed in Stage 1 rather than adding a parallel channel.

**Touch is not optional here.** There is no hover on a phone, and this link is built to be pasted into Discord. Once the route highlight is the main way to read the board, hover-only costs a mobile visitor the entire page, not just the tags. Rows must be tappable to pin a route, with a tap elsewhere to clear.

**Also verify at a phone viewport**, which is untested so far: my attempt to resize the browser to 430 px did not take, so there is currently **no evidence** about how `fitView` behaves with 16 systems in a phone-sized canvas, or whether the 10 px static labels survive that zoom. Check it directly. If tiles are illegible at fit zoom, the small breakpoint needs its own layout rather than a stacked desktop one, and that becomes its own stage.

**Measured at 390 px** (window resize still refuses to take; measured in a 390 px frame instead). The stacked layout works and the board is the page: rows are full-size, legible, and tappable, and tapping one lights its route. The canvas is not. With the board capped at 45vh the chain gets a 386 × 232 px box, and `fitView` shrinks 11 systems to roughly a 0.35 zoom — system names land around 6 px, and the static labels, security badges and sig tags are decoration rather than text. So the canvas at small breakpoints is a picture of the chain's shape, not something to read, and **a small-screen canvas layout is its own stage**: the board needs no further work, the canvas needs either a taller share of the screen with a raised `minZoom`, or a pan-and-read treatment instead of fit-to-view.

**Done when:** hovering or tapping a home entrance lights its full path with sig tags on every hop, the highlight clears cleanly, the interaction works on a touch viewport, and `ci-verifier` is green.
