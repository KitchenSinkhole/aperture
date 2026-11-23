## BlackoutBanner

**Purpose:** Persistent, non-dismissible strip at the top of the map view that tells every viewer Blackout is on.
**File:** `src/components/map/BlackoutBanner.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| blackout | BlackoutStatus | yes | The viewer's live Blackout standing (`useBlackoutStatus`). |

### Renders
Nothing while `blackout.active` is false. Otherwise a full-width, high-contrast inverted strip (`role="status"`, `data-blackout="cleared" | "restricted"`) with an eye-off icon, "Blackout in effect." and one of two variants:
- not cleared: "Pilot locations are hidden. You can still see your own characters."
- cleared: "Members can't see pilot locations. You can."

When `since` is set it also shows the start time in EVE time (UTC, day + month + HH:MM), formatted from the timestamp alone so server and client renders agree.

### Behaviour & Interactions
- No dismiss control; it stays until Blackout lifts.
- Names no individual (not who turned it on).
- Visually distinct from the degraded-realtime `RealtimeStatusBanner`, which can show at the same time.

### Depends On
- `EyeOff` from `lucide-react`
- Type `BlackoutStatus` from `@/types`
