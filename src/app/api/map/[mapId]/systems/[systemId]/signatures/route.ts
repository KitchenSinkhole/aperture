import 'server-only';
import { type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMapSystem } from '@/db/schema';
import { getSession } from '@/lib/session';
import { loadSignaturesForSystems } from '@/lib/map/systemNode';
import { parseBigInt, requireMapView } from '../../../../utils';

/**
 * GET /api/map/[mapId]/systems/[systemId]/signatures
 * The placed system's current signatures (LEFT JOIN universe_wormhole for
 * `wormholeCode`). The canvas calls this to hydrate a (re)added system's sigs on
 * the `system.added` event — signatures no longer ride the event payload (that
 * breached the 8 KB `pg_notify` ceiling). Returns `[]` for a brand-new system.
 *
 * [systemId] is `ap_map_system.id` (the xyflow node id), NOT the EVE solar-system id.
 *
 * Access: view-only — anyone who can see the map may read it.
 */

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ mapId: string; systemId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId, systemId: rawSystemId } = await params;
  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const mapSystemId = parseBigInt(rawSystemId);
  if (!mapSystemId) {
    return Response.json({ ok: false, error: 'Invalid system id.' }, { status: 400 });
  }

  // The system must belong to the guarded map — otherwise a viewer of map A
  // could harvest signatures from a system on map B by id.
  const [owned] = await db
    .select({ id: apMapSystem.id })
    .from(apMapSystem)
    .where(and(eq(apMapSystem.id, mapSystemId), eq(apMapSystem.mapId, guard.mapId)));
  if (!owned) {
    return Response.json({ ok: false, error: 'System not found.' }, { status: 404 });
  }

  const data = await loadSignaturesForSystems([mapSystemId]);
  return Response.json({ ok: true, data });
}
