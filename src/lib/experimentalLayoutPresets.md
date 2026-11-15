## experimentalLayoutPresets.ts

**Purpose:** Experimental layout presets (scanning / combat / travel): panel visibility, `hidden`, and resize tweaks on the default experimental layout.
**File:** `src/lib/experimentalLayoutPresets.ts`

### experimentalLayoutPreset(preset)
Clones `EXPERIMENTAL_DEFAULT_MAP_LAYOUT`, sets `layoutPreset`, hides panels not in the preset focus set (stored in `hidden`, restorable from the Panels menu), and adjusts key panel heights on `lg`/`md`/`sm`.

### exportLayoutJson / importLayoutJson
JSON helpers for layout copy/import flows.