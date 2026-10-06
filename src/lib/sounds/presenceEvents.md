## presenceEvents.ts

**Purpose:** Decide which cue, and which variant of it, a tracked pilot's jump earns, relative to where the viewer's active character is sitting.
**File:** `src/lib/sounds/presenceEvents.ts`

Pure — no React and no browser imports — so the sound bridges hold no branching logic of their own.

---

### TraversalLike (type)
`{ characterId: number; fromSystemId: number; toSystemId: number }` — the part of `MapPresenceContext`'s `Traversal` this module reads, kept structural so the module stays free of component imports.

---

### classifyTraversal(t: TraversalLike, mySystemId: number | null, viewerCharacterIds: ReadonlySet<number>): 'pilotArrived' | 'pilotLeft' | null
`'pilotArrived'` when the jump ends in `mySystemId`, `'pilotLeft'` when it starts there, `null` otherwise.

**Parameters:**
- `t` — the detected jump, keyed by EVE solar-system id
- `mySystemId` — the solar system the viewer's active character is located in; `null` (no located character) yields `null`
- `viewerCharacterIds` — the viewer's own characters; their jumps never earn a cue

**Returns:** The sound event to play, or `null` for silence.

---

### watchedJumpVariant(t: Pick<TraversalLike, 'fromSystemId' | 'toSystemId'>, mySystemId: number | null): SoundVariant
`'inbound'` when the jump ends in `mySystemId`, `'outbound'` when it starts there, `'plain'` when the viewer sits elsewhere or has no located character. Unlike `classifyTraversal` an unlocated viewer still gets a cue, just an undirected one.

**Parameters:**
- `t` — the detected jump, keyed by EVE solar-system id
- `mySystemId` — the solar system the viewer's active character is located in

**Returns:** The variant to pass to `engine.play('watchedJump', ...)`.
