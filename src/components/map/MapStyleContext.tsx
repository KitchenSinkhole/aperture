'use client';

import { createContext, useContext } from 'react';

import type { MapStyleOptions } from '@/components/map/styling';

const DEFAULT_OPTS: MapStyleOptions = { palette: 'default', theme: 'dark' };

const MapStyleContext = createContext<MapStyleOptions>(DEFAULT_OPTS);

export function MapStyleProvider({
  value,
  children,
}: {
  value: MapStyleOptions;
  children: React.ReactNode;
}) {
  return <MapStyleContext.Provider value={value}>{children}</MapStyleContext.Provider>;
}

export function useMapStyleOptions(): MapStyleOptions {
  return useContext(MapStyleContext);
}
