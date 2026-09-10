## TransitSignaturePrompt

**Purpose:** After one of the viewer's own pilots jumps through a wormhole, prompt them to pick which source-system signature they transited and auto-populate its "Leads to".
**File:** `src/components/map/TransitSignaturePrompt.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| systems | MapSystemNode[] | yes | All placed systems; used to resolve EVE ids → map systems. |
| connections | MapConnectionEdge[] | yes | All edges; used to find the folded WH connection and rule out gate jumps. |
| signatures | MapSignature[] | yes | All sigs; the candidate list is the source system's wormhole sigs. |
| viewerCharacters | { id: number; name: string }[] | yes | The viewer's own characters — only their jumps fire the prompt, and the jumper's name is shown in the title. |
| onPatchSignature | (signatureId: string, patch: { mapConnectionId: string }) => void | yes | Commits the "Leads to" binding (MapCanvas's optimistic `onSignaturePatch`). |
| onConnectionPatch | (connectionId: string, patch: UpdateConnectionBody) => void | yes | Auto-sets the folded connection's jump-mass size from the picked sig's type (MapCanvas's optimistic `onConnectionPatch`). |

### Renders
A small dismissible `Card` pinned to the canvas top-left (`absolute left-2 top-2 z-10`, `nodrag nopan`), titled "<character> jumped into <dest> — which signature?" (the jumping pilot is named so alts moving around the chain aren't confused), with one outline button per candidate sig (`sigId` + WH code / "no type") and an `X` dismiss. Renders `null` when there's no active prompt or zero candidates.

### Behaviour & Interactions
- Subscribes via `useTraversals`; ignores jumps whose `characterId` isn't one of `viewerCharacters` (the matched character's `name` is shown in the prompt title).
- A qualifying jump needs the source and destination on the map, no `stargate` connection between them, and a `wh`-scope connection between them (the server-folded hole). A `stargate` link between the two ⇒ gate jump, never prompts.
- **Buffered against the fold-vs-breadcrumb race.** The `characterUpdate` that fires the traversal can arrive before the `connection.create` it was broadcast after has folded into client state. Every viewer jump (except gate/already-mapped ones) is recorded in the `pending` buffer; the displayed prompt is *derived each render* by resolving buffered jumps against live props (`systems`/`connections`/`signatures`), so a jump surfaces the moment its fold lands — whether that's the same render or a beat later. A timer prunes a jump whose fold never arrives within `BUFFER_TTL_MS` (3s); a jump that has become resolvable (shown) is exempt, so the TTL bounds only the wait, and a shown prompt persists until acted on.
- A new traversal by a pilot supersedes that pilot's own still-buffered jump (a pilot is only ever in one place); buffered entries dedupe by `from→to` EVE-system key, so a fleet jumping the same hole shows one prompt.
- One prompt shows at a time (the first resolvable buffered jump); a second resolvable jump waits for the current one to clear.
- Suppressed for already-mapped holes: a jump whose `wh` connection has a signature bound to it resolves to `drop` and never shows, re-evaluated every render so a hole mapped while a jump sat buffered never prompts. Clicking a candidate binds a sig and thus self-suppresses; dismissing (the `X`) removes only that buffered jump with no lasting suppression, so a later tracked jump of a still-unmapped hole prompts again.
- While a prompt is shown, loads the `typeId → targetClass` and `typeId → jumpMassClass` maps via `fetchWormholeCatalog` (system-independent catalog facts; shared session-wide cache, usually warm) — the first filters candidates, the second drives the connection-size auto-set.
- Candidates (pure `transitCandidates` helper): source-system `wormhole` sigs **not already bound to any connection**, whose type's `targetClass` matches the destination class, or whose type leads anywhere (K162 / `targetClass == null`), or which have no type set (`typeId == null`).
- Clicking a candidate calls `onPatchSignature(sig.id, { mapConnectionId })`, then — when the sig already carries a type with an inferable band — `onConnectionPatch(connectionId, { jumpMassClass })` (e.g. B274 → M), then — when the sig carries a non-`none` EOL stage (`sig.eolStage`) — `onConnectionPatch(connectionId, { eolStage: sig.eolStage })`, then dismisses. Never sets the sig's `typeId` — destination class alone can't identify the exact WH code.
- Filaments and unscanned sources yield zero candidates ⇒ nothing renders.

### Emits / Calls
- `onPatchSignature(signatureId, { mapConnectionId })` — populates "Leads to".
- `onConnectionPatch(connectionId, { jumpMassClass })` — sets the connection size from the sig type's band.
- `useTraversals(cb)` — subscribes to pilot jumps from `MapPresenceContext`.
- `fetchWormholeCatalog()` — WH-type catalog (target class + jump-mass band).

### Exports
- `transitCandidates(args)` — pure candidate filter (source-system wormhole sigs unbound to any connection and type-compatible with the destination class), unit-testable without React.

### Depends On
- `MapPresenceContext` (`useTraversals`, must be inside `MapPresenceProvider`).
- `@/lib/map/transitResolve` — `resolveTransit` (jump → the crossed `wh` connection, with gate links dropped) and `BUFFER_TTL_MS`. The already-mapped-hole rule is a filter this component applies on top of that result.
- `Card`, `Button` (shadcn/ui); `fetchWormholeCatalog` (`src/lib/map/client.ts`).

### Local State
- `prompt: Prompt | null` — the active jump being asked about.
- `pending: PendingJump[]` — viewer jumps buffered while their fold catches up to client state; the shown prompt is derived from this list each render, and a timer prunes entries whose fold never lands within `BUFFER_TTL_MS`.
- `targetClassByTypeId: Map<number, string | null>` — loaded WH-type catalog for the source system.
- `jumpMassByTypeId: Map<number, WhJumpMass | null>` — per-type inferred jump-mass band for the connection-size auto-set.
