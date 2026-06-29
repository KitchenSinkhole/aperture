import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import {
  loadActivityStats,
  resolveStatsAccess,
  type ActivityStatScope,
} from '@/lib/stats/activity';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/statistics?scope=&period=&anchor=
 *
 * Global (not map-scoped) activity statistics for the Statistics dialog.
 * Aggregates `ap_activity_rollup` over every map of `scope` the session can
 * view, attributing activity to account mains. Returns
 * `{ ok, availableScopes, rows, label, prevAnchor, nextAnchor, hasNext }`.
 *
 * Access: any logged-in character. The requested `scope` must be one the actor
 * qualifies for (`resolveStatsAccess`), else 403.
 */

export const runtime = 'nodejs';

const querySchema = z.object({
  scope: z.enum(['private', 'corp', 'alliance']),
  period: z.enum(['week', 'month', 'year']).default('week'),
  anchor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const GET = withApiMetrics('/api/statistics', async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.characterId) {
    return Response.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  const parsed = querySchema.safeParse({
    scope: request.nextUrl.searchParams.get('scope'),
    period: request.nextUrl.searchParams.get('period') ?? undefined,
    anchor: request.nextUrl.searchParams.get('anchor') ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ ok: false, error: 'Invalid query.' }, { status: 400 });
  }

  const availableScopes = await resolveStatsAccess(session);
  if (!availableScopes.includes(parsed.data.scope as ActivityStatScope)) {
    return Response.json(
      { ok: false, error: 'Forbidden.', availableScopes },
      { status: 403 },
    );
  }

  const stats = await loadActivityStats({
    session,
    scope: parsed.data.scope,
    period: parsed.data.period,
    anchor: parsed.data.anchor,
  });

  return Response.json({ ok: true, availableScopes, ...stats });
});
