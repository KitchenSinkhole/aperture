import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MapCanvas } from '@/components/map/MapCanvas';
import { CurrentMapScopeSync } from '@/components/map/CurrentMapScopeSync';
import { loadMapForView, loadMapSettings } from '@/lib/map/loadMap';
import { loadLiveShareBadges } from '@/lib/map/share';
import { canManageMap, resolveMapCapabilities } from '@/lib/auth/rights';
import { loadRouteConfig } from '@/lib/map/routeConfig';
import { statsForSystems } from '@/lib/map/stats';
import { intelForSystems } from '@/lib/map/intel';
import { structuresForSystems } from '@/lib/structures/read';
import {
  getAccountCharacters,
  getConnectionTravelAnimation,
  getMainCharacterId,
  getMapLayout,
  getSignatureIndicatorPrefs,
  requireSession,
} from '@/lib/session';

function parseMapId(slug?: string[]): bigint | null {
  const raw = slug?.[0];
  if (!raw || !/^\d+$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

export default async function MapPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const session = await requireSession();
  const { slug } = await params;
  const mapId = parseMapId(slug);

  if (mapId === null) {
    return (
      <EmptyState
        title="No map selected"
        description="Pick a map from your maps list to view its chain."
      />
    );
  }

  const data = await loadMapForView(mapId, BigInt(session.characterId));
  if (!data) {
    return (
      <EmptyState title="Map not found" description="This map doesn't exist or has been deleted." />
    );
  }

  const systemIds = data.systems.map((s) => s.systemId);
  const [
    stats,
    intel,
    structures,
    settings,
    travelAnimation,
    signatureIndicators,
    accountCharacters,
    mapLayout,
    routeConfig,
    mainCharacterId,
    canManage,
    capabilities,
    liveShares,
  ] = await Promise.all([
    statsForSystems(systemIds),
    intelForSystems(systemIds),
    structuresForSystems(systemIds),
    loadMapSettings(BigInt(session.characterId), mapId),
    getConnectionTravelAnimation(session.userId),
    getSignatureIndicatorPrefs(session.userId),
    getAccountCharacters(session.userId),
    getMapLayout(session.userId),
    loadRouteConfig(session.userId),
    getMainCharacterId(session.userId),
    canManageMap(BigInt(session.characterId), mapId),
    resolveMapCapabilities(BigInt(session.characterId), mapId),
    loadLiveShareBadges(mapId),
  ]);

  // Active characters drive both the CTRL+V paste location check (ids) and the
  // route planner's source-character picker (id + name).
  const activeCharacters = accountCharacters.filter((c) => c.status === 'active');
  const viewerCharacterIds = activeCharacters.map((c) => Number(c.id));
  const viewerCharacters = activeCharacters.map((c) => ({ id: Number(c.id), name: c.name }));

  // Non-null because `loadMapForView` already succeeded for the same viewer/map.
  if (!settings) {
    return (
      <EmptyState title="Map not found" description="This map doesn't exist or has been deleted." />
    );
  }

  return (
    <>
      <CurrentMapScopeSync scope={data.map.type} />
      <MapCanvas
        data={data}
        stats={stats}
        intel={intel}
        structures={structures}
        settings={settings}
        canManage={canManage}
        capabilities={[...capabilities]}
        liveShares={liveShares}
        travelAnimation={travelAnimation}
        signatureIndicators={signatureIndicators}
        viewerCharacterIds={viewerCharacterIds}
        viewerCharacters={viewerCharacters}
        mainCharacterId={mainCharacterId == null ? null : Number(mainCharacterId)}
        routePrefs={routeConfig.prefs}
        routeDestinations={routeConfig.destinations}
        mapLayout={mapLayout}
      />
    </>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        <Link href="/maps" className="text-primary hover:underline">
          Back to maps
        </Link>
      </CardContent>
    </Card>
  );
}
