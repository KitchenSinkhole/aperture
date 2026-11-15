## ExperimentalActiveRouteBridge

**Purpose:** Experimental client alerts for the saved active route — off-route followers (presence) and wormhole hazard on path (EOL critical / link removed) with optional reroute.
**File:** `src/components/map/ExperimentalActiveRouteBridge.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| mapId | string | yes | Map id for `route-plan`. |
| activeRoute | MapActiveRouteView \| null | yes | Saved active route from the server. |
| routePrefs | RoutePrefs | yes | Account route planner prefs for reroute. |
| presence | MapPresenceEntry[] | yes | Live presence for follower checks. |
| connections | MapConnectionEdge[] | yes | Live connections for hop link hazards. |
| primaryCharacterId | number \| null | yes | Character id used for ESI waypoint push on reroute. |
| onRouteUpdated | () => void | no | Called after a successful reroute save (e.g. `router.refresh`). |

### Behaviour
- Off-route toasts when the `activeRouteOffRoute` event row is enabled (independent of the master sound switch); the chime plays only when master + event are on. Optional desktop notification from that row’s `desktopNotification` pref.
- Hazard toasts when the `activeRouteLinkAlert` event is enabled, with the same sound/master/desktop split; optional **Recompute** calls `route-plan` and `setMapActiveRouteAction`.
