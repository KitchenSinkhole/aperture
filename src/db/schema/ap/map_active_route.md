## map_active_route.ts

**Purpose:** Stores an in-progress active route per map for the owning user, with follower character ids embedded on the row.
**File:** `src/db/schema/ap/map_active_route.ts`

### Table `ap_map_active_route`

| Column | Notes |
|---|---|
| `map_id` | FK `ap_map`, cascade delete |
| `owner_user_id` | FK `ap_user`; only this user can read the row |
| `primary_character_id` | FK `ap_character` — character that initiated the route |
| `destination_system_id` | FK `universe_system` |
| `plan_json` | Serialised hops + planner metadata |
| `follower_character_ids` | JSON array of EVE character ids |
| `waypoint_cursor` | Index of the next k-space waypoint to push |
