## reference.ts

**Purpose:** The product-default `BookmarkScheme` every deployment runs unless it drops in an override; concatenates the whole readable transit into a long delimited name per endpoint.
**File:** `src/lib/bookmarking/reference.ts`

The emitted names deliberately exceed EVE's in-game bookmark-name character cap — this scheme exists to exercise the full `BookmarkInput` surface in one file, not to produce a name that fits the client. Names are never truncated or length-capped.

Reads, per endpoint (`here` and `cameFrom`): `name`, `alias`, `tag`, `status`, `security`, `trueSec`, `effect`, `regionName`, `constellationName`, `statics`, `tradeHub`, that endpoint's hop count from `hopsFromHome`, whether it is `homeMapSystemId`, and its degree — the count of `connections` incident to that endpoint (source or target), including `connection` itself. Reads, from the connection: `scope`, `massStatus`, `jumpMassClass`, `eolStage`, `eolAt`, `createdAt`, `isStatic`, `isRolling`, `preserveMass`, `sourceBubbled`, `targetBubbled`. Reads, from each side's matching signature row (selected from `signatures` by `mapSystemId`): `sigId`, `wormholeCode`, `groupKey`, `classKind`, `eolStage`, `name`, `description`, `expiresAt`.

`connections` itself is not dumped into the output beyond each endpoint's degree — the full list would drown every other field.

Does not read `positionX`, `positionY`, `locked`, `lockedByCharacterId`, `lockedByName`, `rallyAt`, `intelNotes`, or any internal id (`id`/`systemId` on a system; `id`/`mapSystemId`/`mapConnectionId`/`typeId` on a signature) — those ids are used only to match rows to endpoints, never emitted. A signature's `typeId` is excluded in favour of its human-facing `wormholeCode`; a static's `typeId` is excluded the same way — only its `label` is emitted.

A null `tag`/`alias`/`effect`/`trueSec`/`jumpMassClass`/`eolAt`/`tradeHub`, an empty `statics` array, an endpoint absent from `hopsFromHome`, a null `homeMapSystemId`, and zero, one, or two matched signature rows all render to a value rather than throwing.

---

### referenceScheme: BookmarkScheme
`names(input)` always returns `{ here, cameFrom }` — never null. Each of the two returned strings encodes the full transit (both endpoints, the connection, and both sides' matched signature) from that endpoint's own perspective.
