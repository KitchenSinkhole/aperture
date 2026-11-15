## experimentalDscanLayout.ts

**Purpose:** Reads and writes D-Scan paste text attached per map system in `layout.panelSettings.dscan` (saved with the user layout; no server table).
**File:** `src/lib/experimentalDscanLayout.ts`

---

### parseExperimentalDscanPanelSettings(layout: MapLayoutConfig): ExperimentalDscanPanelSettings
Returns `attachedBySystemId` from the layout blob, or empty defaults.

---

### mergeDscanAttach(layout: MapLayoutConfig, mapSystemId: string, text: string): MapLayoutConfig
Stores pasted D-Scan text for one system in `panelSettings.dscan`.