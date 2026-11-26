# Experimental panel header actions

Applies when experimental UI is active. Each listed panel shows a **+ Add** control in `MapPanelGroup` `renderHeaderRight`, and a matching command-palette entry when the panel is relevant.

| Panel | + Add behaviour |
| --- | --- |
| `route` | Focus the destination typeahead in `RoutePlannerModule`. |
| `pilots` | Open the map toolbar pilot roster popover. |
| `kills` | Refresh the killboard feed for the selected system. |
| `dscan` | Focus the D-Scan paste textarea. |
| `thera` | Sync all EVE-Scout rows that are not yet on the map. |
| `inspector` | Open **Add system** (same as the map pane context menu). |

Implementation: `experimentalPanelHeaderActions.tsx` renders the button; `experimentalPanelActionBus.ts` notifies mounted panel bodies (and toolbar controls) to run the action.
