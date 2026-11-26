'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { usePresenceForMap } from '@/components/map/MapPresenceContext';

interface MapActiveCharContextValue {
  activeCharId: number | null;
  activeCharSystemId: number | null;
  /** Explicit pick from the pilots panel; when set it overrides the default active char. */
  pickedCharId: number | null;
  locatedChars: { id: number; name: string }[];
  setPickedCharId: (id: number | null) => void;
}

const MapActiveCharContext = createContext<MapActiveCharContextValue | null>(null);

export function MapActiveCharProvider({
  viewerCharacters,
  mainCharacterId,
  children,
}: {
  viewerCharacters: { id: number; name: string }[];
  mainCharacterId: number | null;
  children: ReactNode;
}) {
  const [pickedCharId, setPickedCharId] = useState<number | null>(null);
  const presence = usePresenceForMap();

  const viewerIds = useMemo(() => new Set(viewerCharacters.map((c) => c.id)), [viewerCharacters]);

  const locatedByChar = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of presence) if (viewerIds.has(p.characterId)) m.set(p.characterId, p.systemId);
    return m;
  }, [presence, viewerIds]);

  const locatedChars = useMemo(
    () => viewerCharacters.filter((c) => locatedByChar.has(c.id)),
    [viewerCharacters, locatedByChar],
  );

  const activeCharId = useMemo(() => {
    if (pickedCharId != null && locatedByChar.has(pickedCharId)) return pickedCharId;
    if (mainCharacterId != null && locatedByChar.has(mainCharacterId)) return mainCharacterId;
    return locatedChars[0]?.id ?? null;
  }, [pickedCharId, locatedByChar, mainCharacterId, locatedChars]);

  const activeCharSystemId = activeCharId != null ? (locatedByChar.get(activeCharId) ?? null) : null;

  const value = useMemo(
    () => ({ activeCharId, activeCharSystemId, pickedCharId, locatedChars, setPickedCharId }),
    [activeCharId, activeCharSystemId, pickedCharId, locatedChars],
  );

  return <MapActiveCharContext.Provider value={value}>{children}</MapActiveCharContext.Provider>;
}

export function useMapActiveChar(): MapActiveCharContextValue {
  const ctx = useContext(MapActiveCharContext);
  if (!ctx) throw new Error('useMapActiveChar must be used inside MapActiveCharProvider');
  return ctx;
}
