import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/auth/rights';
import { listAdminMaps } from '@/lib/map/loadMap';
import { MapActionsMenu } from '@/components/admin/MapActionsMenu';

function formatOwner(map: {
  type: string;
  ownerCharacterId: string | null;
  ownerCorporationId: string | null;
  ownerAllianceId: string | null;
}): string {
  switch (map.type) {
    case 'private':
      return map.ownerCharacterId ? `char ${map.ownerCharacterId}` : 'unowned';
    case 'corp':
      return map.ownerCorporationId ? `corp ${map.ownerCorporationId}` : 'unowned';
    case 'alliance':
      return map.ownerAllianceId ? `alliance ${map.ownerAllianceId}` : 'unowned';
    default:
      return 'unowned';
  }
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
});

export default async function AdminMapsPage() {
  const session = await auth();
  if (!(await isAdmin(session))) redirect('/maps');
  const maps = await listAdminMaps();
  // Everyone reaching this page is a global admin, who may purge.
  const canPurge = true;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Maps</h1>
      </header>

      {maps.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No maps.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Scope</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="w-px px-3 py-2 font-medium" aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {maps.map((m) => {
                const softDeleted = m.deletedAt !== null;
                return (
                  <tr key={m.id} className="border-t border-border">
                    <td className="px-3 py-2 align-middle">
                      {softDeleted ? (
                        <span className="text-muted-foreground line-through">{m.name}</span>
                      ) : (
                        <Link
                          href={{ pathname: `/map/${m.id}` }}
                          className="font-medium hover:underline"
                        >
                          {m.name}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle capitalize text-muted-foreground">
                      {m.scope}
                    </td>
                    <td className="px-3 py-2 align-middle capitalize text-muted-foreground">
                      {m.type}
                    </td>
                    <td className="px-3 py-2 align-middle text-muted-foreground">
                      {formatOwner(m)}
                    </td>
                    <td className="px-3 py-2 align-middle text-muted-foreground">
                      {DATE_FORMAT.format(new Date(m.createdAt))}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {softDeleted ? (
                        <span className="inline-flex items-center rounded-md bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                          Soft-deleted {DATE_FORMAT.format(new Date(m.deletedAt!))}
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center justify-end gap-1">
                        {/*
                          Per-map settings / webhooks / audit live in-place on the
                          map (open via the active map's name link), each gated by
                          its own `MapCapability`. This list keeps only operator
                          actions.
                        */}
                        <MapActionsMenu map={m} canPurge={canPurge} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
