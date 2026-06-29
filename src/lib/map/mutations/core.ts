// No `import 'server-only'` here: this is the low-level commit primitive,
// consumed by the high-level mutation wrappers (signatures.ts / connections.ts /
// systems.ts — all of which DO carry `'server-only'` and define the surface a
// client could accidentally import) AND by the graphile-worker tasks,
// which run under plain Node via server.ts and would crash on the bare
// `server-only/index.js` throw (no React `react-server` export condition).
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { apMapEvent } from '@/db/schema';
import { getLogger } from '@/lib/log/logger';
import { recordMapEvent } from '@/lib/metrics/registry';
import {
  mapEventPayloadSchema,
  type MapEventKind,
  type MapEventPatch,
  type MapEventPayload,
} from '@/lib/realtime/protocol';

const WEBHOOK_DISPATCH_TASK = 'webhook-dispatch';
const log = getLogger('server');

/**
 * The single canonical commit point for every map mutation (CLAUDE.md "Mutation
 * pathways"). Each mutation lands as exactly ONE `INSERT INTO ap_map_event`; the
 * `tg_map_event_notify` trigger fan-outs the `payload` verbatim on
 * `map:<map_id>`, so the row write is the only side effect — no application-level
 * `pg_notify`, no dual-write to a parallel audit table.
 *
 * The new event id is pre-allocated from the table's sequence so it can be
 * embedded in the payload (as `eventId`) before the insert fires the trigger —
 * that's the dedupe key the initiating client uses to drop its own realtime echo.
 *
 * Bulk paths (e.g. the signature paste in `bulkSignatures.ts`) pass an outer
 * `tx` so N commits share one transaction and roll back atomically; in that
 * mode `commitMapEvent` throws on failure instead of returning `{ ok: false }`,
 * letting the caller's `db.transaction` abort the entire batch.
 */

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Discriminated result for every mutation pathway (Server Action / API route). */
export type ActionResult<T> =
  | { ok: true; data: T; eventId: number }
  | { ok: false; error: string };

export type CommitMapEventArgs<K extends MapEventKind> = {
  mapId: bigint;
  /** Audit FK (`ap_map_event.character_id`); null when the actor was erased. */
  characterId: bigint | null;
  kind: K;
  /**
   * Runs inside the transaction. Performs the row write(s) and returns the patch
   * body for the event payload (everything except `kind`/`eventId`). The
   * pre-allocated `eventId` is passed in for helpers that need it in the patch.
   */
  mutate: (tx: Tx, eventId: number) => Promise<MapEventPatch<K>>;
  /**
   * Optional caller-owned transaction. When present, `commitMapEvent` runs the
   * mutate + event insert on `tx` directly and surfaces inner failures by
   * throwing — so the caller's outer `db.transaction` rolls back. When absent,
   * `commitMapEvent` opens its own transaction and folds failures into
   * `{ ok: false, error }` (the default behaviour every API route relies on).
   */
  tx?: Tx;
};

/**
 * Open a transaction (or join an outer one), run `mutate`, build
 * `{ kind, eventId, ...patch }`, validate it against `mapEventPayloadSchema`,
 * and insert exactly one `ap_map_event`. An invalid payload or a throwing
 * `mutate` rolls the active transaction back: when running standalone the
 * failure surfaces as `{ ok: false }`; when joined to a caller's `tx` the
 * error re-throws so the outer batch aborts cleanly.
 *
 * Returns the validated payload and its `eventId` on success.
 */
export async function commitMapEvent<K extends MapEventKind>(
  args: CommitMapEventArgs<K>,
): Promise<ActionResult<MapEventPayload>> {
  const { mapId, characterId, kind, mutate, tx: outerTx } = args;

  const run = async (tx: Tx) => {
    const [seq] = (
      await tx.execute(
        sql`SELECT nextval(pg_get_serial_sequence('ap_map_event', 'id')) AS id`,
      )
    ).rows as Array<{ id: string }>;
    const eventId = Number(seq!.id);

    const patch = await mutate(tx, eventId);
    const payload = mapEventPayloadSchema.parse({ kind, eventId, ...patch });
    const occurredAt = new Date();

    await tx
      .insert(apMapEvent)
      .values({ id: BigInt(eventId), mapId, characterId, occurredAt, kind, payload })
      .returning({ id: apMapEvent.id });

    // The canonical activity signal: one tally per committed mutation, split by
    // the bounded 17-value event-kind vocabulary.
    recordMapEvent(kind);

    return { eventId, payload, occurredAt };
  };

  if (outerTx) {
    // Joined to a caller's outer transaction (bulk paste path). Skip the
    // webhook enqueue here: the outer transaction hasn't committed yet, so
    // dispatching could race with rollback. Bulk paths can enqueue once after
    // their outer commit if a use case surfaces (today none does).
    const result = await run(outerTx);
    return { ok: true, data: result.payload, eventId: result.eventId };
  }

  try {
    const result = await db.transaction(run);
    await enqueueWebhookDispatch(mapId, result.eventId, result.occurredAt);
    return { ok: true, data: result.payload, eventId: result.eventId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Mutation failed.' };
  }
}

/**
 * Best-effort fire-and-forget enqueue of the webhook-dispatch job.
 * The EXISTS short-circuit keeps the common case (map with no webhooks
 * configured) free of any graphile-worker traffic. Failures are logged and
 * swallowed — webhook delivery never blocks the underlying map mutation.
 */
export async function enqueueWebhookDispatch(
  mapId: bigint,
  eventId: number,
  occurredAt: Date,
): Promise<void> {
  try {
    const existsRows = (
      await db.execute(
        sql`SELECT EXISTS(SELECT 1 FROM ap_map_webhook WHERE map_id = ${mapId}) AS has_webhook`,
      )
    ).rows as Array<{ has_webhook: boolean }>;
    if (!existsRows[0]?.has_webhook) return;

    await db.execute(sql`
      SELECT graphile_worker.add_job(
        ${WEBHOOK_DISPATCH_TASK},
        json_build_object(
          'mapId', ${mapId.toString()}::text,
          'eventId', ${eventId.toString()}::text,
          'occurredAt', ${occurredAt.toISOString()}::text
        )
      )
    `);
  } catch (err) {
    log.warn('webhook-dispatch enqueue failed', {
      mapId: mapId.toString(),
      eventId,
      err: err instanceof Error ? err.message : err,
    });
  }
}
