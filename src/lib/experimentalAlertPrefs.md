## experimentalAlertPrefs.ts

**Purpose:** Device-local toggles for experimental UI sounds and notifications introduced in the build (all off by default).
**File:** `src/lib/experimentalAlertPrefs.ts`

### Preferences (localStorage)
- `readExperimentalRallyToast` / `writeExperimentalRallyToast` — in-app rally toast (toggle in Account settings → Sounds when experimental UI is on).
- `readExperimentalRallyDesktopNotification` / `writeExperimentalRallyDesktopNotification` — browser `Notification` for rally (same).
- `readExperimentalRouteOffRouteToast` / `writeExperimentalRouteOffRouteToast` — active-route off-route toast (same).
- `readExperimentalRouteHazardToast` / `writeExperimentalRouteHazardToast` — active-route link / EOL toast (same).

Kill mail audio uses the account **Kill in system** sound row (`SystemNotificationSoundBridge`); there is no separate combat-alert pref.
- `readExperimentalRouteOffRouteToast` / `writeExperimentalRouteOffRouteToast` — follower left the active route hop list.
- `readExperimentalRouteHazardToast` / `writeExperimentalRouteHazardToast` — wormhole on the route critical EOL or deleted.

Dispatches `aperture:experimental-alert-prefs` on write. Legacy UI and experimental-off always read `false`.
