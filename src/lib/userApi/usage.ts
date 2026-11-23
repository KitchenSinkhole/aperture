// No `import 'server-only'`, like the rest of `src/lib/userApi`.
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { getLogger } from '@/lib/log/logger';
import { apertureConfig } from '../../../aperture.config';

/**
 * Batched usage accounting for user API tokens. Requests are tallied
 * in-process and written to `ap_map_api_token.last_used_at` / `request_count`
 * in one `UPDATE` at most once per `USER_API_USAGE_FLUSH_MS`. The figures are
 * approximate by design: a restart loses at most one interval, and a failed
 * write drops its batch. Usage never enters `ap_map_event`.
 *
 * State is a `globalThis` singleton so it survives HMR.
 */

type PendingUsage = { id: bigint; count: number; lastUsedAt: number };

interface UsageState {
  pending: Map<string, PendingUsage>;
  timer: ReturnType<typeof setTimeout> | null;
  lastFlushAt: number;
}

declare global {
  var __apertureUserApiUsage: UsageState | undefined;
}

const state: UsageState = globalThis.__apertureUserApiUsage ?? {
  pending: new Map(),
  timer: null,
  lastFlushAt: 0,
};
globalThis.__apertureUserApiUsage = state;

const log = getLogger('server');

function schedule(): void {
  if (state.timer !== null || state.pending.size === 0) return;
  const delay = Math.max(0, state.lastFlushAt + apertureConfig.USER_API_USAGE_FLUSH_MS - Date.now());
  state.timer = setTimeout(() => {
    state.timer = null;
    void flushUserApiUsage();
  }, delay);
  state.timer.unref?.();
}

/** Tallies one request on `tokenId` at `now` and arms the next flush. */
export function recordUserApiUsage(tokenId: bigint, now: number = Date.now()): void {
  const key = tokenId.toString();
  const entry = state.pending.get(key);
  if (entry) {
    entry.count += 1;
    entry.lastUsedAt = Math.max(entry.lastUsedAt, now);
  } else {
    state.pending.set(key, { id: tokenId, count: 1, lastUsedAt: now });
  }
  schedule();
}

/**
 * Writes every pending tally in one `UPDATE` and empties the buffer. Adds each
 * count to `request_count` and moves `last_used_at` forward, never back.
 * Returns the number of tokens in the batch. Never throws.
 */
export async function flushUserApiUsage(): Promise<number> {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  const batch = [...state.pending.values()];
  state.pending.clear();
  state.lastFlushAt = Date.now();
  if (batch.length === 0) return 0;

  const values = sql.join(
    batch.map(
      (u) =>
        sql`(${u.id.toString()}::bigint, ${u.count}::bigint, ${new Date(u.lastUsedAt).toISOString()}::timestamptz)`,
    ),
    sql`, `,
  );
  try {
    await db.execute(sql`
      UPDATE ap_map_api_token AS t
         SET request_count = t.request_count + v.n,
             last_used_at = GREATEST(t.last_used_at, v.used_at)
        FROM (VALUES ${values}) AS v(id, n, used_at)
       WHERE t.id = v.id`);
  } catch (err) {
    log.warn('user API usage flush failed', { tokens: batch.length, err });
  }
  schedule();
  return batch.length;
}

/** Test seam: tokens with a pending tally. */
export function __pendingUserApiUsage(): number {
  return state.pending.size;
}

/** Test seam: drops every pending tally and the armed flush. */
export function __resetUserApiUsage(): void {
  if (state.timer !== null) clearTimeout(state.timer);
  state.pending.clear();
  state.timer = null;
  state.lastFlushAt = 0;
}
