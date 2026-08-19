import Link from 'next/link';
import { getActiveCharacter, requireSession } from '@/lib/session';
import { listViewableMaps } from '@/lib/map/loadMap';
import { mapsWithCapability } from '@/lib/auth/rights';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CreateMapDialog } from '@/components/maps/CreateMapDialog';
import { DeleteMapButton } from '@/components/maps/DeleteMapButton';

export default async function MapsPage() {
  const session = await requireSession();
  const viewerCharacterId = BigInt(session.characterId);
  const [active, maps] = await Promise.all([
    getActiveCharacter(),
    listViewableMaps(viewerCharacterId),
  ]);
  const deletable = await mapsWithCapability(
    viewerCharacterId,
    maps.map((m) => BigInt(m.id)),
    'map_delete',
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Maps</h1>
          {active && <p className="text-sm text-muted-foreground">Signed in as {active.name}.</p>}
        </div>
        <CreateMapDialog />
      </div>

      {maps.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No maps yet</CardTitle>
            <CardDescription>Create your first map to get started.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Use “New map” above. Your private, corp, and alliance maps will appear here.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {maps.map((m) => {
            const canDelete = deletable.has(BigInt(m.id));
            return (
              <div key={m.id} className="group relative">
                <Link href={{ pathname: `/map/${m.id}` }} className="block">
                  <Card size="sm" className="transition-colors hover:ring-foreground/25">
                    <CardHeader>
                      <CardTitle className={canDelete ? 'pr-7' : undefined}>{m.name}</CardTitle>
                      <CardDescription className="capitalize">
                        {m.type} · {m.scope}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
                {canDelete && (
                  <div className="absolute top-2 right-2">
                    <DeleteMapButton mapId={m.id} mapName={m.name} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
