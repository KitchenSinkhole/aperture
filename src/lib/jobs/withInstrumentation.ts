import { eq, sql } from 'drizzle-orm';
import type { JobHelpers, Task } from 'graphile-worker';
import { apertureConfig } from '../../../aperture.config';
import { db } from '@/db/client';
import { apJobRun } from '@/db/schema';
import { recordJobRun } from '@/lib/metrics/registry';

interface InstrumentationOptions {
  /**
   * 1-in-N success sampling for high-frequency writers. When > 1, successful
   * runs are persisted only ~1-in-N (each surviving row carrying `weight = N`),
   * while every failure is still written. When absent or ≤ 1, every run is
   * persisted (full fidelity, two-phase insert-then-finalise).
   */
  successSampleRate?: number;
}

/**
 * Wrap a graphile-worker task handler so its invocations are recorded in
 * `ap_job_run` (observability).
 *
 * Full-fidelity (default): the row is inserted at the start of the run (so an
 * in-flight handler is visible as `ended_at IS NULL`), then finalised on
 * completion with `success`, optional `errorText`, and any `notes` the handler
 * returned.
 *
 * Sampled (`successSampleRate > 1`, for high-frequency tasks like location-poll):
 * no in-flight row is written; on success a single completed row is inserted only
 * ~1-in-N (weighted `N`), on failure a single completed row is always inserted.
 * The `job_runs_total{task,outcome}` counter is incremented on every invocation
 * regardless, so it remains the sampling-immune source of truth.
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
  opts?: InstrumentationOptions,
): Task {
  const sampleRate = opts?.successSampleRate ?? 1;
  if (sampleRate > 1) {
    return async (payload, helpers) => {
      const startedWall = new Date();
      const startedAt = performance.now();
      try {
        const result = await run(payload as TPayload, helpers);
        recordJobRun(name, 'success', performance.now() - startedAt);
        if (Math.random() * sampleRate < 1) {
          await db.insert(apJobRun).values({
            name,
            startedAt: startedWall,
            endedAt: sql`now()`,
            success: true,
            notes: capNotes(result),
            weight: sampleRate,
          });
        }
      } catch (err) {
        recordJobRun(name, 'failure', performance.now() - startedAt);
        await db.insert(apJobRun).values({
          name,
          startedAt: startedWall,
          endedAt: sql`now()`,
          success: false,
          errorText: capError(err),
        });
        throw err;
      }
    };
  }

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
