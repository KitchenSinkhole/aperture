## mapRouteFavourites.ts

**Purpose:** Server actions for per-map route destination favourites (experimental routes panel).
**File:** `src/app/(app)/actions/mapRouteFavourites.ts`

---

### addMapRouteFavouriteAction(input)
Pins a universe system on a map for the viewer; optional label and shared flag.

### removeMapRouteFavouriteAction(input)
Removes a favourite by id for the viewer when `mapId` and favourite row match and the viewer can view the map.