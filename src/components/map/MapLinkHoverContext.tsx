'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type LinkHover = {
  edgeId: string | null;
  sourceId: string | null;
  targetId: string | null;
};

const MapLinkHoverContext = createContext<{
  hover: LinkHover;
  setHover: (next: LinkHover) => void;
} | null>(null);

export function MapLinkHoverProvider({ children }: { children: ReactNode }) {
  const [hover, setHover] = useState<LinkHover>({
    edgeId: null,
    sourceId: null,
    targetId: null,
  });
  const value = useMemo(() => ({ hover, setHover }), [hover]);
  return <MapLinkHoverContext.Provider value={value}>{children}</MapLinkHoverContext.Provider>;
}

export function useMapLinkHover(): LinkHover {
  return useContext(MapLinkHoverContext)?.hover ?? { edgeId: null, sourceId: null, targetId: null };
}

export function useSetMapLinkHover(): (next: LinkHover) => void {
  const ctx = useContext(MapLinkHoverContext);
  return useCallback(
    (next: LinkHover) => {
      ctx?.setHover(next);
    },
    [ctx],
  );
}

export function useIsLinkHoverDimActive(): boolean {
  const { edgeId } = useMapLinkHover();
  return edgeId !== null;
}

export function useIsLinkEndpointLit(mapSystemId: string): boolean {
  const { sourceId, targetId } = useMapLinkHover();
  return mapSystemId === sourceId || mapSystemId === targetId;
}
