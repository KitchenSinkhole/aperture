import { eq, sql } from 'drizzle-orm';
import type { JobHelpers, Task } from 'graphile-worker';
import { apertureConfig } from '../../../aperture.config';
import { db } from '@/db/client';
import { apJobRun } from '@/db/schema';
import { recordJobRun } from '@/lib/metrics/registry';

/**
 * Wrap a graphile-worker task handler so every invocation is recorded in
 * `ap_job_run` (observability). The row is inserted at the start of
 * the run (so an in-flight handler is visible as `ended_at IS NULL`), then
 * finalised on completion with `success`, optional `errorText`, and any
 * `notes` the handler returned.
 *
 * On failure the wrapper re-throws so graphile-worker handles retry/backoff;
 * we only persist what happened, we don't swallow.
 *
 * Inner handler may return:
 *   - nothing (void) — the run row gets `success = true`, `notes = null`
 *   - a value — coerced via JSON.stringify and stored in `notes`
 *
 * Notes are size-capped per `apertureConfig.JOB_INSTRUMENTATION_NOTES_MAX_BYTES`
 * to keep pathological handler returns from blowing up the row; oversize
 * payloads are replaced with `{ truncated: true, originalLength: N }`.
 */
export function withInstrumentation<TPayload>(
  name: string,
  run: (payload: TPayload, helpers: JobHelpers) => Promise<unknown> | unknown,
): Task {
  return async (payload, helpers) => {
    const inserted = await db
      .insert(apJobRun)
      .values({ name })
      .returning({ id: apJobRun.id });
    const id = inserted[0]!.id;

    const startedAt = performance.now();
    try {
      const result = await run(payload as TPayload, helpers);
      recordJobRun(name, 'success', performance.now() - startedAt);
      await db
        .update(apJobRun)
        .set({
          endedAt: sql`now()`,
          success: true,
          notes: capNotes(result),
        })
        .where(eq(apJobRun.id, id));
    } catch (err) {
      recordJobRun(name, 'failure', performance.now() - startedAt);
      await db
        .update(apJobRun)
        .set({
          endedAt: sql`now()`,
          success: false,
          errorText: capError(err),
        })
        .where(eq(apJobRun.id, id));
      throw err;
    }
  };
}

function capError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const max = apertureConfig.JOB_INSTRUMENTATION_ERROR_MAX_LENGTH;
  return message.length > max ? message.slice(0, max) : message;
}

function capNotes(result: unknown): unknown {
  if (result === undefined || result === null) return null;
  const encoded = JSON.stringify(result);
  if (encoded === undefined) return null; // unserialisable (function, bigint, etc.)
  if (encoded.length > apertureConfig.JOB_INSTRUMENTATION_NOTES_MAX_BYTES) {
    return { truncated: true, originalLength: encoded.length };
  }
  return result;
}
