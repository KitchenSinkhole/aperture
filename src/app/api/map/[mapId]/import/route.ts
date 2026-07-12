import 'server-only';
import { type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { importMapData, mapExportSchema } from '@/lib/map/transfer';
import { requireMapCapability } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/map/[mapId]/import — merge a `MapExportFile` into the open map.
 * Validates the body against `mapExportSchema`, then runs `importMapData`
 * (one transaction, N `commitMapEvent`s). Returns `{ ok, data: { summary,
 * payloads }, eventId: 0 }` — the bulk shape; consumers read
 * `data.payloads[].eventId`.
 *
 * Access: the `map_import` capability (manager implicitly, or a delegated corp
 * title).
 */

export const runtime = 'nodejs';

export const POST = withApiMetrics('/api/map/:mapId/import', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapCapability(rawMapId, session, 'map_import');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = mapExportSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Not a valid map export file.' },
      { status: 400 },
    );
  }

  const result = await importMapData({
    mapId: guard.mapId,
    characterId: guard.characterId,
    data: parsed.data,
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
});
