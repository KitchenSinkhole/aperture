'use client';

import {
  MenuCheckboxItem,
  MenuItem,
  MenuSubmenu,
  MenuSubmenuContent,
  MenuSubmenuTrigger,
} from '@/components/ui/menu';
import type { MapSystemNode } from '@/types';
import { systemDisplayName } from '@/lib/eve/drifterSystems';
import { SOUND_MUTE_GROUP_LABELS } from '@/lib/sounds/catalog';
import { useSoundPrefs } from '@/lib/sounds/engine';
import {
  MAX_SYSTEM_SOUND_MUTES,
  SOUND_MUTE_GROUPS,
  isSystemMuteListFull,
  setSystemSoundMute,
  soundMutesFor,
} from '@/lib/sounds/prefs';
import { saveSoundPrefs } from '@/lib/sounds/savePrefs';

/**
 * "Sounds" submenu on a system: one checkbox per mute group. Self-contained
 * like `WatchConnectionItem`: it reads the engine's prefs and saves through
 * `saveSoundPrefs` rather than routing through a `MapCanvas` callback. Absent
 * while the account's master sound switch is off.
 *
 * On the Home system it edits the account's Home mutes, which follow whichever
 * system is Home on each map.
 */
export function SystemSoundMuteItem({
  system,
  isHome,
  onClose,
}: {
  system: MapSystemNode;
  isHome: boolean;
  onClose: () => void;
}) {
  const prefs = useSoundPrefs();
  if (!prefs.enabled) return null;

  const target = {
    systemId: system.systemId,
    name: systemDisplayName(system.systemId, system.name),
    isHome,
  };
  const mutes = soundMutesFor(prefs, target);
  const full = isSystemMuteListFull(prefs, target);

  return (
    <MenuSubmenu>
      <MenuSubmenuTrigger inset>{isHome ? 'Sounds (Home)' : 'Sounds'}</MenuSubmenuTrigger>
      <MenuSubmenuContent>
        {SOUND_MUTE_GROUPS.map((group) => (
          <MenuCheckboxItem
            key={group}
            checked={mutes[group]}
            disabled={full && !mutes[group]}
            onCheckedChange={(checked) => {
              void saveSoundPrefs(setSystemSoundMute(prefs, target, group, checked), prefs);
              onClose();
            }}
          >
            Mute {SOUND_MUTE_GROUP_LABELS[group].label.toLowerCase()}
          </MenuCheckboxItem>
        ))}
        {full && (
          <MenuItem disabled className="text-[10px] leading-tight text-muted-foreground">
            {MAX_SYSTEM_SOUND_MUTES} systems muted; remove one in Account settings
          </MenuItem>
        )}
      </MenuSubmenuContent>
    </MenuSubmenu>
  );
}
