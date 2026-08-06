# Bubbled Connection Ends

**Goal:** Make each connection endpoint an interactable element on the map canvas, and let users flag either end of a connection as bubbled (issue #159).

**References:** `CLAUDE.md` (companion `.md` standing instruction, mutation pathways, DB rules), `src/components/map/ConnectionEdge.md`, `src/components/map/useEdgeAnchors.md`, `src/lib/map/edgeAnchors.md`, `src/components/map/MapContextMenu.md`, `src/lib/map/mutations/connections.md`.

## Context

Pathfinder let you flag one *end* of a connection as bubbled and drew a small bubble at the system/connection interface. Aperture lost that. Issue #159 was parked because every connection converged on a single point per node, so there was nowhere to hang a per-end mark. That is no longer true: `src/lib/map/edgeAnchors.ts` + `useEdgeAnchors.ts` already give each connection its own fanned attachment point on a node face.

This work makes that attachment point a real, interactable element and hangs a per-end `bubbled` flag off it. The endpoint element is deliberately its own component because issue #124 will grow it into a drag handle for overriding face placement — this is the seam for that, not just the bubble. Dragging endpoints (#124 itself) is out of scope here.

**Decisions taken:** the only edit surface is the endpoint's own right-click menu (no inspector checkbox, no entry in the existing edge menu). The endpoint dot stays invisible until the pointer is near the edge. Spectator maps render bubbles read-only, gated by a new per-share toggle.

## Stage 1 — Data model

**Mode:** Accept edits

**Goal:** Two independent per-end booleans (both ends can be bubbled at once), plus import/export fidelity.

**Touches:** `src/db/schema/ap/map_connection.ts`, `src/db/migrations/0065_connection_bubbled.sql` (+ `.rollback.sql`), `src/lib/map/transfer.ts`

- Add `sourceBubbled: boolean('source_bubbled').notNull().default(false)` and `targetBubbled` likewise. Update `map_connection.md` (schema companions may cite the migration as bare provenance).
- Generate the migration with `pnpm db:generate`, then hand-write the rollback (two `DROP COLUMN`s). Nothing to backfill — the default covers existing rows.
- `transfer.ts`: add both to the export select, the export mapping, the import insert, and the zod row schema as `z.boolean().optional().default(false)`, matching the `isStatic` precedent so pre-0065 export files still import.

**Done when:** `pnpm db:migrate` applies cleanly against the dev DB and `pnpm typecheck` passes. (`DATABASE_URL` must be exported from `.env` by hand for the db scripts.)

## Stage 2 — Server pathway

**Mode:** Accept edits

**Goal:** Carry the two flags through the existing per-flag connection pathway. No new mechanisms.

**Touches:** `src/lib/map/loadMap.ts`, `src/lib/realtime/protocol.ts`, `src/lib/map/mutations/connections.ts`, `src/app/api/map/[mapId]/connections/[connId]/route.ts`, `src/lib/map/client.ts`, `src/lib/map/applyEvent.ts`, `src/lib/webhooks/formatters.ts`

- `loadMap.ts` — add both to `MapConnectionEdge` and to the connection SELECT (~line 341).
- `protocol.ts` — add both to `connectionEdgeBody` (drives `connection.create`) and to the `connection.update` all-optional patch variant.
- `connections.ts` — add both to `UpdateConnectionPatch` and the `'sourceBubbled' in patch` set-builder in `updateConnection`, and to `createConnection`'s optional flag overrides + emitted body.
- Route — two `z.boolean().optional()` keys on `updateConnectionBodySchema`. No extra side-effect hook (unlike `isStatic`).
- `client.ts` — add both to `UpdateConnectionBody`.
- `applyEvent.ts` — two more `if (payload.X !== undefined)` lines in the `connection.update` fold (~line 92).
- `formatters.ts` — `describeConnectionChanges` currently takes only the event; give it the `WebhookEventContext` so a bubble change can name the end it happened at, e.g. `bubbled at **Jita**` / `bubble cleared at **Jita**` (from `ctx.sourceSystemName` / `ctx.targetSystemName`, which `audit.ts` already resolves for `connection.update`). A bare "bubbled" would be useless in the audit log — which end is the whole point.

**Done when:** a PATCH with `{ sourceBubbled: true }` persists, and the audit browser shows the change naming the correct system.

## Stage 3 — The interactable endpoint and the bubble

**Mode:** Plan mode

**Goal:** The visual and interaction work: a hoverable/right-clickable endpoint, and the bubble rendering.

**Touches:** `src/components/map/ConnectionBubble.tsx` (new), `src/components/map/ConnectionEndpoint.tsx` (new), `src/components/map/ConnectionEdge.tsx`, `src/components/map/styling.ts`, `src/components/map/MapCanvas.tsx`

**`ConnectionBubble.tsx`** — pure visual, shared by the app and spectator edges. Given the edge's path `d`, this end's anchor point and the far anchor point, it renders two SVG siblings:

1. A **gradient wash** along the connection: an overlay `<path>` reusing the same `d`, stroked several px wider than the line, with `stroke="url(#…)"` pointing at a `<linearGradient gradientUnits="userSpaceOnUse">` running from this end's anchor to the point 20% of the way toward the far anchor. Stops go from the bubble colour at moderate alpha to fully transparent, so `spreadMethod="pad"` leaves the remaining 80% untouched — no `strokeDasharray` maths, and it tracks the bezier's curvature. Gradient ids must be unique per edge and end.
2. The **bubble**: a circle centred on the anchor, nudged a few px outward along the face normal so it reads as sitting at the mouth rather than under the tile — translucent grayish-blue fill with a slightly stronger stroke of the same hue.

Render it *before* `<BaseEdge>` so the wash paints under the line, and keep it `pointer-events: none`. Put the colour in `styling.ts` next to the other SVG-consumed colours (it must not be a Tailwind token) — both edge components import it.

**`ConnectionEndpoint.tsx`** — the interactable element, app canvas only. Per end it renders a transparent hit circle (~11px radius, `pointerEvents: 'all'`, `nodrag nopan`, pointer cursor) plus a small faint dot shown only when `visible`. `onContextMenu` does `preventDefault()` + `stopPropagation()` and calls up with `(end, clientX, clientY)`; a plain left click is left to bubble so the existing `onEdgeClick` selection still works. Kept separate from the bubble so #124 can add drag handlers here without touching the visual.

**`ConnectionEdge.tsx`** — add a transparent wide hover path over the stroke (the exact pattern `PublicConnectionEdge.tsx` already uses for its sig-tag hover: `stroke="transparent" strokeWidth={20}`, `pointerEvents: 'stroke'`) driving a local `hovered` state; render `<ConnectionEndpoint>` at each anchor with `visible={hovered}`, and `<ConnectionBubble>` at each end whose flag is set. Endpoints must fall back to the xyflow-supplied `sourceX/Y` props while nodes are unmeasured, same as `pathArgs` does.

Menu wiring: extend `ConnectionEdgeData` with a stable `onEndpointContextMenu: (connectionId, end, clientX, clientY) => void`, supplied from the edge `useMemo` in `MapCanvas.tsx` (~line 1783) as a `useCallback` so the memo stays cheap.

**Done when:** hovering an edge reveals a dot at each end; right-clicking one opens a menu; a bubbled end shows the circle and the wash fading out about a fifth of the way along the line.

## Stage 4 — Context menu + canvas wiring

**Mode:** Accept edits

**Goal:** A dedicated endpoint context menu carrying the bubbled toggle.

**Touches:** `src/types/index.ts`, `src/components/map/MapCanvas.tsx`, `src/components/map/MapContextMenu.tsx`

- `MapContextMenuTarget` gains a `connectionEnd` variant: `{ kind: 'connectionEnd'; id: string; end: 'source' | 'target'; x: number; y: number }`.
- `MapCanvas.tsx` — the new endpoint callback sets that target. Existing `onEdgeContextMenu` is unchanged (right-clicking the *line* still opens the connection menu).
- `MapContextMenu.tsx` — a `ConnectionEndItems` branch in `renderItems()`: a single `MenuCheckboxItem` labelled `Bubbled at <SystemName>` (resolve the end's `ap_map_system` id off the connection row, then its name from the `systems` prop — the menu already receives both), calling `onConnectionPatch(id, { sourceBubbled: … })`. Reuse the existing "… not found" disabled fallback when the connection id no longer resolves.

**Done when:** toggling from the endpoint menu updates every open tab (optimistic locally, `connection.update` over the socket for everyone else).

## Stage 5 — Spectator maps

**Mode:** Accept edits

**Goal:** Read-only bubbles on public shares, gated by a new per-share toggle alongside the two that already exist.

**Touches:** `src/db/schema/ap/map_share.ts`, migration, `src/lib/map/loadPublicMap.ts`, `src/lib/map/share.ts`, `src/app/(app)/actions/mapShares.ts`, `src/components/map/manage/MapSharePanel.tsx`, `src/components/public/PublicConnectionEdge.tsx`, `src/lib/realtime/protocol.ts`, `src/types/index.ts`

- `map_share.ts` — `showBubbles: boolean('show_bubbles').notNull().default(false)`. Fold into migration 0065 if Stage 1 hasn't been applied yet, otherwise a separate 0066.
- `loadPublicMap.ts` — add `sourceBubbled` / `targetBubbled` to `PublicMapConnectionEdge`, emitting `false` for both when the share has the toggle off. Redaction is server-side; the client never receives a suppressed flag.
- `share.ts`, `mapShares.ts`, `MapSharePanel.tsx` — carry the flag through create/update and add the checkbox to the share form, mirroring `showConnectionSigIds` everywhere it appears.
- `PublicConnectionEdge.tsx` — render `<ConnectionBubble>` at each flagged end. No hit target, no endpoint dot: spectators can't edit.

**Done when:** a share with the toggle on shows bubbles at `/live/<token>`; a share with it off shows none, and the flags are absent from the payload on the wire.

## Stage 6 — Endpoint hit targets on a crowded face

**Mode:** Plan mode

**Goal:** Make right-clicking a *specific* endpoint reliable on a node face carrying several connections.

**Problem:** `anchorPoint` fans a face's endpoints at `pitch = min(BASE_PITCH_PX, (faceLength - FACE_MARGIN_PX) / (count - 1))` — at most 12px apart, and closer as node degree grows. `ConnectionEndpoint`'s hit circle is `HIT_RADIUS_PX = 11` (times `useMarkScale()`), so from degree 2 upward on a face the circles overlap, and by degree 4 or so each one is mostly buried under its neighbours. Overlaps resolve by DOM order across separate edge elements, which follows nothing a user could predict — so the armed halo can light up on a connection the pointer is not nearest to. Stage 3's armed state makes the mistake *visible* before the click lands, but the target itself is still wrong.

**Touches:** `src/lib/map/edgeAnchors.ts`, `src/components/map/useEdgeAnchors.ts`, `src/components/map/ConnectionEndpoint.tsx`

**Approach — size the hit target from the live pitch, anisotropically.** Neighbours separate only *along* the face, so shrinking the target in both axes throws away room that exists. Replace the hit circle with a face-oriented slot: half-extent along the face capped at `pitch / 2`, half-extent along the face normal left at the current radius. Targets become disjoint by construction while keeping the generous reach outward from the mouth, which is the direction the pointer arrives from.

- `edgeAnchors.ts` — lift the pitch expression out of `anchorPoint` into an exported `facePitch(rect, face, count)` that `anchorPoint` then calls. `count <= 1` yields 0, meaning unconstrained.
- `useEdgeAnchors.ts` — `EdgeAnchor` gains `pitch: number`, filled by `endpointAnchor` from `facePitch`. `anchorsEqual` must compare it, or a degree change that leaves this edge's own anchor coordinates untouched won't re-render the endpoint.
- `ConnectionEndpoint.tsx` — derive the slot's along-face half-extent as `min(HIT_RADIUS_PX * scale, pitch / 2)`. The clamp goes *after* the mark scaling and against the raw pitch: the mark holds a constant screen size and so grows in flow space as the canvas zooms out, whereas the pitch is fixed in flow space. Draw the armed halo to the same shape (a rounded `<rect>` oriented to the face, or an `<ellipse>`) — the premise of the armed state is that the mark is congruent with what responds, so the mark has to narrow along with it.

Zoomed far out, `pitch / 2` is only a few screen px and individual endpoints stop being pickable. That is inherent to a fan that tight and is acceptable: the connection's own line menu stays reachable throughout.

**Rejected:** a single hit-test overlay per node face owning all its endpoints and dispatching to the nearest anchor. It gives each endpoint a true Voronoi cell, but moves endpoint hit-testing out of the per-edge component into a node-level layer, fighting the edge-owned model and complicating the drag handle #124 wants on that same element. Not worth it over a pitch-sized slot.

**Done when:** on a node with 5+ connections sharing one face, sweeping the pointer along the fan arms each endpoint in turn with no dead bands and no band claimed by two edges, and the armed mark covers exactly the region that responds.

## Verification

1. `pnpm dev`, open a map with a node carrying several connections. Confirm the pre-existing fan still looks right, then hover an edge: a dot appears at each end.
2. Right-click one dot, toggle `Bubbled at <system>`. The bubble and its wash appear on that end only. Toggle the other end; both coexist. Toggle off; both clear.
3. Open the same map in a second tab and repeat: the change must arrive over the socket without a refresh.
4. Check a *short* connection (two adjacent nodes) — the 20% wash has little room there; if it looks cramped, cap the gradient length in absolute px as well as by fraction.
5. Map settings, Audit tab: the toggle is logged naming the correct end's system.
6. Mint a share with bubbles on, load `/live/<token>`, confirm bubbles render and nothing is interactable. Mint one with it off and confirm the flags never reach the client (check the snapshot in the network tab, not just the render).
7. Export the map, re-import it, confirm the bubbled ends survive the round trip.
8. Park a node with 5+ connections leaving one face and sweep the pointer across the fan: each endpoint arms in turn, in the order they sit on the face.
9. `pnpm lint && pnpm typecheck && pnpm build` (`ci-verifier`). No DB integration tests exist for connection flags, so there is nothing to add under `RUN_DB_TESTS` beyond the existing suite staying green.
