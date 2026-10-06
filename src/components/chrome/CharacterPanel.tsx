'use client';

import { useEffect, useState, useTransition } from 'react';
import { useParams } from 'next/navigation';
import { LogOut, Plus, Settings } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  addCharacterAction,
  getMapTrackingAction,
  setCharacterTrackingAction,
  signOutAction,
} from '@/app/(app)/actions/character';
import { AccountSettingsDialog } from '@/components/account/AccountSettingsDialog';
import type { SignatureIndicatorAccountSettings, SoundPrefs } from '@/types';

export type PanelCharacter = {
  id: string;
  name: string;
  status: 'active' | 'kicked' | 'banned';
  authzLevel: 'member' | 'admin';
};

function portraitUrl(characterId: string, size = 64): string {
  return `https://images.evetech.net/characters/${characterId}/portrait?size=${size}`;
}

/** The open map's id from the `/map/[[...slug]]` route, or null when not on a map. */
function currentMapIdFromParams(slug: unknown): string | null {
  if (!Array.isArray(slug)) return null;
  const first = slug[0];
  return typeof first === 'string' && /^\d+$/.test(first) ? first : null;
}

export function CharacterPanel({
  active,
  characters,
  mainCharacterId,
  travelAnimation,
  signatureIndicators,
  soundPrefs,
}: {
  active: { id: string; name: string };
  characters: PanelCharacter[];
  mainCharacterId: string | null;
  travelAnimation: boolean;
  signatureIndicators: SignatureIndicatorAccountSettings;
  soundPrefs: SoundPrefs;
}) {
  const params = useParams();
  const currentMapId = currentMapIdFromParams(params?.slug);
  const onMap = currentMapId !== null;
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  // Per-map tracking selection, lazy-loaded when the Sheet opens on a map.
  // `loaded` (derived) gates the checkboxes until the server's selection for the
  // *current* map has arrived, so we never render a stale all-on/all-off guess —
  // including when the map changes while the Sheet stays open.
  const [tracking, setTracking] = useState<Record<string, boolean>>({});
  const [mapName, setMapName] = useState<string | null>(null);
  const [loadedMapId, setLoadedMapId] = useState<string | null>(null);
  const loaded = currentMapId !== null && loadedMapId === currentMapId;

  // Re-gate on every open/close so a reopen always waits for a fresh fetch.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    setLoadedMapId(null);
  }

  useEffect(() => {
    if (!open || currentMapId === null) return;
    let cancelled = false;
    void getMapTrackingAction(currentMapId).then((res) => {
      if (cancelled) return;
      const tracked = new Set(res.trackedIds);
      setTracking(Object.fromEntries(characters.map((c) => [c.id, tracked.has(c.id)])));
      setMapName(res.mapName);
      setLoadedMapId(currentMapId);
    });
    return () => {
      cancelled = true;
    };
  }, [open, currentMapId, characters]);

  function onToggle(id: string, next: boolean) {
    if (currentMapId === null) return;
    setTracking((t) => ({ ...t, [id]: next }));
    startTransition(async () => {
      const result = await setCharacterTrackingAction(id, currentMapId, next);
      if (!result.ok) {
        setTracking((t) => ({ ...t, [id]: !next }));
        toast.error(result.error);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="default" className="gap-2">
            <Avatar size="sm">
              <AvatarImage src={portraitUrl(active.id, 32)} alt={active.name} />
              <AvatarFallback>{active.name.slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className="font-medium">{active.name}</span>
          </Button>
        }
      />
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Characters</SheetTitle>
          <SheetDescription>
            {onMap
              ? mapName
                ? `Choose which characters Aperture tracks on ${mapName}.`
                : 'Choose which characters Aperture tracks on this map.'
              : 'Open a map to choose which characters Aperture tracks on it.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-1 px-4">
          {characters.map((c) => {
            const isMain = c.id === mainCharacterId;
            const inactive = c.status !== 'active';
            return (
              <label
                key={c.id}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm',
                  inactive ? 'opacity-50' : 'hover:bg-muted',
                )}
              >
                <Avatar size="sm">
                  <AvatarImage src={portraitUrl(c.id, 32)} alt={c.name} />
                  <AvatarFallback>{c.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate">
                  {c.name}
                  {isMain && <span className="ml-1.5 text-xs text-muted-foreground">main</span>}
                </span>
                {inactive ? (
                  <span className="text-xs text-muted-foreground capitalize">{c.status}</span>
                ) : onMap ? (
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={tracking[c.id] ?? false}
                    disabled={pending || !loaded}
                    onChange={(e) => onToggle(c.id, e.target.checked)}
                    aria-label={`Track ${c.name}`}
                  />
                ) : null}
              </label>
            );
          })}
        </div>

        <div className="mt-auto flex flex-col gap-2 p-4">
          <form action={addCharacterAction}>
            <Button type="submit" variant="outline" className="w-full gap-2" disabled={pending}>
              <Plus />
              Add character
            </Button>
          </form>
          <Button
            type="button"
            variant="ghost"
            className="w-full gap-2"
            disabled={pending}
            onClick={() => {
              setOpen(false);
              setSettingsOpen(true);
            }}
          >
            <Settings />
            Account settings
          </Button>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" className="w-full gap-2" disabled={pending}>
              <LogOut />
              Sign out
            </Button>
          </form>
        </div>
      </SheetContent>

      <AccountSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        characters={characters}
        mainCharacterId={mainCharacterId}
        activeCharacter={active}
        travelAnimation={travelAnimation}
        signatureIndicators={signatureIndicators}
        soundPrefs={soundPrefs}
      />
    </Sheet>
  );
}
