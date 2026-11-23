## mapRouteFavourites.ts

**Purpose:** Server actions for per-map route destination favourites (experimental routes panel).
**File:** `src/app/(app)/actions/mapRouteFavourites.ts`

---

### addMapRouteFavouriteAction(input)
Pins a universe system on a map for the viewer; optional label and shared flag.

### removeMapRouteFavouriteAction(input)
Removes a favourite row by id after a map view check.

### listMapRouteFavouritesAction(mapId)
Returns favourites visible to the viewer on the map.