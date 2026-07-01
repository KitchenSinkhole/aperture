import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { pasteSignatures } from '@/lib/map/mutations/bulkSignatures';
import { signatureClassKind } from '@/db/schema';
import { resolveSignatureRows } from '@/lib/map/signatureReader';
import type { ParsedSigRow } from '@/lib/map/signatureParser';
import { apertureConfig } from '../../../../../../../aperture.config';
import { parseBigInt, requireMapMutate } from '../../../utils';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';

/**
 * POST /api/map/[mapId]/signatures/bulk — diff a paste against a system's sigs
 * and commit add/update/remove (+ optional connection tear-down) atomically.
 * Returns `{ ok, data: { summary, payloads }, eventId: 0 }` on success — the
 * bulk path produces N events, so consumers read `data.payloads[].eventId`.
 *
 * Server re-resolves the parsed rows authoritatively; the dialog's own resolve
 * call is best-effort preview only.
 *
 * Access: `map_update` right on the target map.
 */

const parsedRowSchema = z.object({
  sigId: z.string().min(1).max(7),
  name: z.string().nullable(),
  groupName: z.string().nullable(),
  signal: z.string().nullable(),
  classKind: z.enum(signatureClassKind.enumValues),
});

const bulkPasteBodySchema = z.object({
  mapSystemId: z.string().regex(/^\d+$/),
  rows: z.array(parsedRowSchema).max(500),
  options: z.object({
    addMissing: z.boolean(),
    updateExisting: z.boolean(),
    removeMissing: z.boolean(),
    removeOrphanedConnections: z.boolean(),
  }),
});

export const runtime = 'nodejs';

export const POST = withApiMetrics('/api/map/:mapId/signatures/bulk', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ mapId: string }> },
) {
  const session = await getSession();
  const { mapId: rawMapId } = await params;
  const guard = await requireMapMutate(rawMapId, session, 'map_update');
  if (!guard.ok) {
    return Response.json({ ok: false, error: guard.error }, { status: guard.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }

  const parsed = bulkPasteBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 },
    );
  }

  const mapSystemId = parseBigInt(parsed.data.mapSystemId);
  if (!mapSystemId)
    return Response.json({ ok: false, error: 'Invalid system id.' }, { status: 400 });

  const resolved = await resolveSignatureRows(parsed.data.rows as ParsedSigRow[]);

  const result = await pasteSignatures({
    mapId: guard.mapId,
    mapSystemId,
    characterId: guard.characterId,
    rows: resolved,
    options: parsed.data.options,
    defaultExpiresAt: new Date(Date.now() + apertureConfig.SIGNATURE_DEFAULT_TTL_MS),
  });

  return Response.json(result, { status: result.ok ? 200 : 400 });
});
