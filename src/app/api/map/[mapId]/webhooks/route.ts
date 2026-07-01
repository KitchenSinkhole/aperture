import 'server-only';
import { type NextRequest } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMapWebhook } from '@/db/schema';
import { getSession } from '@/lib/session';
import { canManageMap } from '@/lib/auth/rights';
import { requireMapView } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/map/[mapId]/webhooks
 * The webhook list behind the in-map Settings → Webhooks tab. Read-only.
 *
 * Access: `canManageMap` only (private-map owner, owning-corp Director,
 * owning-alliance executor-corp Director, or admin). Layered on `requireMapView`
 * so a missing / unviewable map returns 404 (no existence leak) and a plain
 * member with view access gets 403.
 *
 * Returns the full webhook URL (a map manager needs it to edit) — the client
 * masks it in the table for shoulder-surfing defense.
 */

export const runtime = 'nodejs';

export const GET = withApiMetrics('/api/map/:mapId/webhooks', async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;

  const guard = await requireMapView(rawMapId, session);
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }
  if (!(await canManageMap(guard.characterId, guard.mapId))) {
    return Response.json({ ok: false, error: 'Forbidden.' }, { status: 403 });
  }

  const rows = await db
    .select({
      id: apMapWebhook.id,
      channel: apMapWebhook.channel,
      event: apMapWebhook.event,
      url: apMapWebhook.url,
      username: apMapWebhook.username,
      lastStatus: apMapWebhook.lastStatus,
      lastError: apMapWebhook.lastError,
      lastAttemptedAt: apMapWebhook.lastAttemptedAt,
      consecutiveFailures: apMapWebhook.consecutiveFailures,
    })
    .from(apMapWebhook)
    .where(eq(apMapWebhook.mapId, guard.mapId))
    .orderBy(asc(apMapWebhook.event), asc(apMapWebhook.id));

  const webhooks = rows.map((w) => ({
    id: w.id.toString(),
    channel: w.channel,
    event: w.event,
    url: w.url,
    username: w.username,
    lastStatus: w.lastStatus,
    lastError: w.lastError,
    lastAttemptedAt: w.lastAttemptedAt ? w.lastAttemptedAt.toISOString() : null,
    consecutiveFailures: w.consecutiveFailures,
  }));

  return Response.json({ ok: true, data: { webhooks } });
});
