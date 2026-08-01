import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import { resolveIntegrationToken } from '@/lib/integrations/token';
import { loadPresenceSessions } from '@/lib/integrations/presence';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';
import { apertureConfig } from '../../../../../aperture.config';

/**
 * POST /api/integrations/presence-sessions
 *
 * Machine-to-machine, token-authenticated raw presence-interval feed
 * (docs/spec/integration-activity-stats.md), for consumers building
 * `character_session` rows. Body: { characterIds, from?, to? }. Returns
 * { generatedAt, coverage, characters }.
 *
 * Access: `Authorization: Bearer <token>` resolving to a corporation
 * (`ap_integration_token`) — every returned session is scoped to that corp
 * (`ap_character_presence.corporation_id`). Gated behind `INTEGRATIONS_ENABLED`
 * (404 when off).
 *
 * Unlike `activity-stats`, the window is always bounded: an omitted `from`
 * defaults to `to - INTEGRATION_PRESENCE_DEFAULT_WINDOW_DAYS`, and a span
 * wider than `INTEGRATION_PRESENCE_MAX_WINDOW_DAYS` is a 400 telling the
 * caller to page.
 */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const presenceSessionsBodySchema = z.object({
  characterIds: z
    .array(z.number().int().positive())
    .min(1)
    .max(apertureConfig.INTEGRATION_MAX_CHARACTER_IDS),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

const MS_PER_DAY = 86_400_000;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withApiMetrics(
  '/api/integrations/presence-sessions',
  async function POST(request: NextRequest) {
    if (!env.INTEGRATIONS_ENABLED) {
      return Response.json({ error: 'Not found.' }, { status: 404 });
    }

    const token = await resolveIntegrationToken(request);
    if (!token) {
      return Response.json(
        { error: 'Unauthorized.' },
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
    }

    const parsed = presenceSessionsBodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 },
      );
    }

    const toDate = parsed.data.to ? new Date(`${parsed.data.to}T00:00:00Z`) : new Date();
    const to = parsed.data.to ?? toDate.toISOString().slice(0, 10);
    const fromDate = parsed.data.from
      ? new Date(`${parsed.data.from}T00:00:00Z`)
      : new Date(toDate.getTime() - apertureConfig.INTEGRATION_PRESENCE_DEFAULT_WINDOW_DAYS * MS_PER_DAY);
    const from = parsed.data.from ?? fromDate.toISOString().slice(0, 10);

    const windowDays = Math.round((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY) + 1;
    if (windowDays > apertureConfig.INTEGRATION_PRESENCE_MAX_WINDOW_DAYS) {
      return Response.json(
        {
          error: `Window exceeds ${apertureConfig.INTEGRATION_PRESENCE_MAX_WINDOW_DAYS} days; page across multiple requests.`,
        },
        { status: 400 },
      );
    }

    const result = await loadPresenceSessions({
      corporationId: token.corporationId,
      characterIds: parsed.data.characterIds.map((id) => BigInt(id)),
      from,
      to,
    });

    return Response.json(result);
  },
);
