import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { requireMapView } from '../../utils';
import { resolveRouteShortcut } from '@/lib/map/routeShortcuts';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

export const runtime = 'nodejs';

const querySchema = z.object({
  from: z.coerce.number().int().positive(),
  kind: z.enum(['nearest_highsec']),
});

export const GET = withApiMetrics('/api/map/:mapId/route-shortcut', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid request.' }, { status: 400 });
  }

  const systemId = await resolveRouteShortcut(parsed.data.kind, parsed.data.from);
  if (systemId == null) {
    return Response.json({ ok: false, error: 'No high-sec system reachable via gates.' });
  }
  return Response.json({ ok: true, data: { systemId } });
});
