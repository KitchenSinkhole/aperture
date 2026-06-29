import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getLogger } from '@/lib/log/logger';
import { allowClientError } from '@/lib/log/clientErrorRate';
import { apertureConfig } from '../../../../aperture.config';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/client-errors
 * Ingest a browser-side error (React render crash, window.onerror, unhandled
 * rejection) captured by `ClientErrorBoundary` / `ClientErrorReporter`. Body:
 * { message, stack?, componentStack?, route? }.
 *
 * Writes one scrubbed `ap_error_log` row (`source='client'`) via the structured
 * logger — the logger's `scrubContext` strips any PII the client sent and only
 * the character *id* is attached. Rate-limited per session + globally so a
 * render loop can't flood the table. The client ignores the response body; the
 * `{ ok }` shape exists for curl/tests.
 */

const clientErrorBodySchema = z.object({
  message: z.string().min(1),
  stack: z.string().optional(),
  componentStack: z.string().optional(),
  route: z.string().optional(),
});

export const runtime = 'nodejs';

function truncate(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

export const POST = withApiMetrics('/api/client-errors', async function POST(request: NextRequest) {
  const session = await getSession();
  const sessionKey = session?.characterId ?? 'anon';

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = clientErrorBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  if (!allowClientError(sessionKey)) {
    return Response.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  }

  const message = truncate(parsed.data.message, apertureConfig.CLIENT_ERROR_MESSAGE_MAX_LENGTH)!;
  getLogger('client').error(message, {
    stack: truncate(parsed.data.stack, apertureConfig.CLIENT_ERROR_STACK_MAX_LENGTH),
    componentStack: truncate(parsed.data.componentStack, apertureConfig.CLIENT_ERROR_STACK_MAX_LENGTH),
    route: parsed.data.route,
    characterId: session?.characterId,
  });

  return Response.json({ ok: true }, { status: 200 });
});
