import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { killboardForSystem } from '@/lib/map/killboard';
import { ZkbHttpError, ZkbRateLimitError } from '@/lib/integrations/zkb';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/system/[systemId]/killboard?limit=
 *
 * Recent zKillboard kills for one system (public per-system data — not
 * map-scoped), enriched with victim-ship names/icons. Fetched on demand when a
 * system is selected. Returns `{ ok:true, kills }` or, on zkb failure, an
 * `{ ok:false, error }` with a 429 (rate-limited) / 502 (upstream) status so the
 * module can show a degraded state instead of an empty list.
 *
 * Access: any logged-in character.
 */

export const runtime = 'nodejs';

const paramsSchema = z.object({ systemId: z.coerce.number().int().positive() });
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

export const GET = withApiMetrics('/api/system/:systemId/killboard', async function GET(
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
    limit: request.nextUrl.searchParams.get('limit') ?? undefined,
  });
  if (!parsedQuery.success) {
    return Response.json({ ok: false, error: 'Invalid query.' }, { status: 400 });
  }

  try {
    const kills = await killboardForSystem(parsedParams.data.systemId, parsedQuery.data.limit);
    return Response.json({ ok: true, kills });
  } catch (err) {
    if (err instanceof ZkbRateLimitError) {
      return Response.json(
        { ok: false, error: 'zKillboard rate limit reached — try again shortly.' },
        { status: 429 },
      );
    }
    if (err instanceof ZkbHttpError) {
      return Response.json({ ok: false, error: 'zKillboard is unavailable.' }, { status: 502 });
    }
    return Response.json({ ok: false, error: 'Failed to load killboard.' }, { status: 500 });
  }
});
