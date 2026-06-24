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
- Ignores the jump unless the source system is on the map, the two systems have no `stargate` connection between them, and a `wh`-scope connection between them exists (the server-folded hole).
- Suppressed for already-mapped holes: if any signature is already bound to the folded `wh` connection, the prompt never opens (re-jumping or an alt re-traversing a populated hole stays silent).
- Dedupes by `from→to` EVE-system key, so a fleet jumping the same hole shows one prompt.
- On open, loads the `typeId → targetClass` and `typeId → jumpMassClass` maps via `fetchWormholeCatalog` (system-independent catalog facts; shared session-wide cache, usually warm) — the first filters candidates, the second drives the connection-size auto-set.
- Candidates (pure `transitCandidates` helper): source-system `wormhole` sigs **not already bound to any connection**, whose type's `targetClass` matches the destination class, or whose type leads anywhere (K162 / `targetClass == null`), or which have no type set (`typeId == null`).
- Clicking a candidate calls `onPatchSignature(sig.id, { mapConnectionId })`, then — when the sig already carries a type with an inferable band — `onConnectionPatch(connectionId, { jumpMassClass })` (e.g. B274 → M), then dismisses. Never sets the sig's `typeId` — destination class alone can't identify the exact WH code.
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
- `Card`, `Button` (shadcn/ui); `fetchWormholeCatalog` (`src/lib/map/client.ts`).

### Local State
- `prompt: Prompt | null` — the active jump being asked about.
- `targetClassByTypeId: Map<number, string | null>` — loaded WH-type catalog for the source system.
- `jumpMassByTypeId: Map<number, WhJumpMass | null>` — per-type inferred jump-mass band for the connection-size auto-set.
