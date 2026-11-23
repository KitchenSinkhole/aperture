## CurrentRoutePanel.tsx

**Purpose:** Experimental Current Route grid panel — live active route, followers, remaining hop breadcrumb.
**File:** `src/components/sidebar/CurrentRoutePanel.tsx`

**Props:** `activeRoute`, `viewData`, `primaryCharacterId`, optional `onSetRoute`, `onStopRoute`, `onHopClick` — refresh pushes remaining k-space waypoints; stop deletes the owner's active-route row via `clearMapActiveRouteAction` (follower ids on that row are cleared with it). Hop markers match `RouteHopBreadcrumb` in the Routes panel.

### Behaviour
- `remainingActiveRouteHops` trims passed hops from the stored plan using waypoint cursor and primary pilot presence (full route, not on-map-only).
- Layout mirrors a Routes `DestinationRow` (bordered block, hop strip, link-style waypoint refresh).
