// No `import 'server-only'`: the operator's settings action and the mint
// action read and invalidate this beside the rest of `src/lib/userApi`, which
// is runner-safe throughout.
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { apInstance } from '@/db/schema';
import { apertureConfig } from '../../../aperture.config';

/**
 * The operator's kill switch for the whole `/api/v1/*` user API
 * (`ap_instance.user_api_enabled`), cached in-process for
 * `USER_API_AUTH_CACHE_TTL_MS` so a request does not read the singleton.
 *
 * State is a `globalThis` singleton so it survives HMR.
 */

interface InstanceSwitchState {
  value: boolean;
  expiresAt: number;
  inflight: Promise<boolean> | null;
  /** Bumped by every invalidation; a read begun under an older value is not cached. */
  generation: number;
}

declare global {
  var __apertureUserApiInstance: InstanceSwitchState | undefined;
}

const state: InstanceSwitchState = globalThis.__apertureUserApiInstance ?? {
  value: true,
  expiresAt: 0,
  inflight: null,
  generation: 0,
};
globalThis.__apertureUserApiInstance = state;

async function readSwitch(): Promise<boolean> {
  const [row] = await db
    .select({ enabled: apInstance.userApiEnabled })
    .from(apInstance)
    .where(eq(apInstance.id, 1));
  // A deployment whose singleton row was never written has the column default.
  return row?.enabled ?? true;
}

/** Whether the operator has the user API on. */
export async function isUserApiInstanceEnabled(now: number = Date.now()): Promise<boolean> {
  if (state.expiresAt > now) return state.value;
  if (state.inflight) return state.inflight;

  const generation = state.generation;
  const pending = readSwitch()
    .then((value) => {
      if (generation === state.generation) {
        state.value = value;
        state.expiresAt = now + apertureConfig.USER_API_AUTH_CACHE_TTL_MS;
      }
      return value;
    })
    .finally(() => {
      if (state.inflight === pending) state.inflight = null;
    });
  state.inflight = pending;
  return pending;
}

/** Drops the cached switch, so the next call reads it. Call after the toggle commits. */
export function invalidateUserApiInstanceSwitch(): void {
  state.generation += 1;
  state.expiresAt = 0;
  state.inflight = null;
}
