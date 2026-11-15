## SystemSoundMuteItem

**Purpose:** The system context menu's `Sounds ▸` submenu, muting the system's kill, pilot, or rally-and-ping cues for the account.
**File:** `src/components/map/SystemSoundMuteItem.tsx`

### Props

| Prop | Type | Required | Description |
|---|---|---|---|
| system | MapSystemNode | yes | The right-clicked system; its EVE id keys the mute |
| isHome | boolean | yes | Whether it is the open map's Home |
| onClose | () => void | yes | Dismisses the menu after a pick |

### Renders
A submenu trigger, `Sounds` (or `Sounds (Home)` on the Home node), opening three checkboxes in `SOUND_MUTE_GROUPS` order: `Mute kills`, `Mute pilots`, `Mute rally & ping`. Renders nothing while the account's master sound switch is off.

### Behaviour & Interactions
- Each checkbox shows `soundMutesFor` for the system, so a group muted by either the Home mutes or the system's own entry reads as checked.
- Toggling saves `setSystemSoundMute(...)` through `saveSoundPrefs` and closes the menu. On Home, muting writes the account's Home mutes, which apply to the Home of every map; elsewhere it writes the system's own entry, which holds on every map the system appears on. Unmuting clears both.
- With `MAX_SYSTEM_SOUND_MUTES` systems already muted and this one not among them, the unchecked items are disabled and a hint row points to Account settings.
- Self-contained like `WatchConnectionItem`: no `MapCanvas` callback is involved.

### Emits / Calls
- `saveSoundPrefs(next, prev)` — from `@/lib/sounds/savePrefs`
- `useSoundPrefs()` — from `@/lib/sounds/engine`

### Depends On
- `@/components/ui/menu` — `MenuSubmenu`, `MenuSubmenuTrigger`, `MenuSubmenuContent`, `MenuCheckboxItem`, `MenuItem`
- `@/lib/sounds/prefs` — `soundMutesFor`, `setSystemSoundMute`, `isSystemMuteListFull`
- `@/lib/eve/drifterSystems` — `systemDisplayName`, the name stored on the entry
