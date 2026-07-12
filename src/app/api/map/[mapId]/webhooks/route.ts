import 'server-only';
import { type NextRequest } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMapWebhook } from '@/db/schema';
import { getSession } from '@/lib/session';
import { requireMapCapability } from '../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * GET /api/map/[mapId]/webhooks
 * The webhook list behind the in-map Settings → Webhooks tab. Read-only.
 *
 * Access: the `webhooks_manage` capability — held implicitly by a manager
 * (private-map owner, owning-corp Director, owning-alliance executor-corp
 * Director, or admin) and grantable to a specific corp title via
 * `ap_map_role_access`. A missing / unviewable map returns 404 (no existence
 * leak); a plain member with only view access gets 403.
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

  const guard = await requireMapCapability(rawMapId, session, 'webhooks_manage');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
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
