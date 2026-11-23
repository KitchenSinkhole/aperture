## map_route_favourite.ts

**Purpose:** Per-map pinned route destinations; personal or shared within the map.
**File:** `src/db/schema/ap/map_route_favourite.ts`

### Table `ap_map_route_favourite`

| Column | Notes |
|---|---|
| `map_id` | FK `ap_map` |
| `user_id` | FK `ap_user` — who created the pin |
| `system_id` | FK `universe_system` |
| `label` | Optional display label |
| `shared` | When true, visible to other map viewers |

Unique on `(map_id, user_id, system_id)`.
