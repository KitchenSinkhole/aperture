## ExperimentalMapSoundMutesPanel

**Purpose:** Map settings UI listing per-system sound mutes stored in layout `panelSettings.sound` for the open map.
**File:** `src/components/map/manage/ExperimentalMapSoundMutesPanel.tsx`

### Props

`mapId`, `mapSystems` (`id`, `name`, `alias`), `settings` (`ExperimentalSoundLayoutSettings`), `onSettingsChange`.

### Renders

When no systems are muted, a short hint pointing at the map context menu. Otherwise one card per muted system with **Unmute all** and per-event checkboxes (disabled when the system is fully muted).