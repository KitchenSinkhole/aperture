## page.tsx (maps list)

**Purpose:** Authenticated landing at `/maps` — greets the active character and lists viewable maps as cards linking to the read-only map view.
**File:** `src/app/(app)/maps/page.tsx`

### Renders
A "Maps" heading + "Signed in as {name}" line with a `CreateMapDialog` ("New map") trigger in the header row, then a responsive grid of map `Card`s (name + type · scope) linking to `/map/<id>`, each overlaid top-right with a `DeleteMapButton` only on cards the viewer holds `map_delete` on. Falls back to an empty-state card when there are no maps. Content is wrapped in a `mx-auto max-w-6xl` container because the `(app)` layout's `<main>` is now full-width.

### Behaviour & Interactions
- Server component; reads the active character via `getActiveCharacter` and the viewer-scoped maps via `listViewableMaps(viewerCharacterId)` (scope+owner+role-overlay filtered SQL), then batches `mapsWithCapability(viewerCharacterId, mapIds, 'map_delete')` (`@/lib/auth/rights`) to resolve which cards get the delete affordance.
- The per-card delete button (and its absolute-positioned wrapper) render only when the viewer holds `map_delete` on that map, so no dead hit-target sits in the corner of a card the viewer cannot delete. When present, it is a sibling of the `Link` (not nested) to keep valid HTML; the card title reserves right padding only when the button is present.
- Create / delete mutate via Server Actions that `revalidatePath('/maps')`, so this list re-renders after either.

### Depends On
- `getActiveCharacter` (`src/lib/session.ts`), `listViewableMaps` + `mapsWithCapability` (`src/lib/map/loadMap.ts`, `src/lib/auth/rights.ts`), `Card` UI primitive, `CreateMapDialog` + `DeleteMapButton` (`src/components/maps/*`).
