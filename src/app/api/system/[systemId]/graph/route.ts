import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { systemStatsSeries } from '@/lib/map/stats';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/system/[systemId]/graph?range=
 *
 * Bucketed activity time-series (jumps / ship / pod / NPC kills) for one system,
 * over `ap_system_stats`. Fetched on demand for the system-graph module. The
 * K-space gate lives in the module (it doesn't fetch for wormholes); for J-space
 * systems this simply returns an empty series.
 *
 * Access: any logged-in character.
 */

export const runtime = 'nodejs';

const paramsSchema = z.object({ systemId: z.coerce.number().int().positive() });
const querySchema = z.object({ range: z.enum(['24h', '7d', '30d']).default('7d') });

export const GET = withApiMetrics('/api/system/:systemId/graph', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ systemId: string }> },
) {
  const session = await getSession();
  if (!session?.characterId) {
    return Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const parsedParams = paramsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return Response.json({ ok: false, error: 'Invalid system.' }, { status: 400 });
  }
  const parsedQuery = querySchema.safeParse({
    range: request.nextUrl.searchParams.get('range') ?? undefined,
  });
  if (!parsedQuery.success) {
    return Response.json({ ok: false, error: 'Invalid query.' }, { status: 400 });
  }

  const series = await systemStatsSeries(parsedParams.data.systemId, parsedQuery.data.range);
  return Response.json({ ok: true, series });
});
