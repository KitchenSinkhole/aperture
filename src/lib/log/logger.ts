// No `import 'server-only'`: the structured logger is reached from background-job
// code (runner, location-poll, mass-log) that the custom `server.ts` loads via
// tsx outside Next's bundler, where the `server-only` shim doesn't resolve. Same
// precedent as `rights.ts` / `bus.ts` / `connectionMassLog.ts`.
import pino from 'pino';
import { db } from '@/db/client';
import { apErrorLog } from '@/db/schema';
import { env } from '@/lib/env';
import { metrics, ERROR_LOG_EVENTS_TOTAL } from '@/lib/metrics/registry';
import { scrubContext } from './scrub';
import type { ErrorSource } from '@/types';

/**
 * Structured logging for Aperture, wrapping pino.
 *
 * pino emits one JSON object per line to stdout (no `transport` option) so a
 * self-hoster's `docker logs` / journald is machine-parseable. Worker-thread
 * transports are deliberately avoided — they break under bare `tsx` (the
 * background worker) and the Next bundler. The pino singleton is held on
 * `globalThis` across HMR, mirroring `bus.ts` / the metrics registry.
 *
 * `error`/`fatal` logs are ALSO persisted (best-effort) as a scrubbed
 * `ap_error_log` row, so an aggregator-less deployment still has queryable error
 * history. `warn`/`info`/`debug` go to stdout only.
 */

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;
}

declare global {
  var __apertureLogger: pino.Logger | undefined;
}

const base =
  globalThis.__apertureLogger ??
  pino({ level: env.NODE_ENV === 'test' ? 'silent' : 'info' });

if (env.NODE_ENV !== 'production') globalThis.__apertureLogger = base;

/**
 * Pull a usable `character_id` out of context when present. Accepts the bigint /
 * number / digit-string shapes call sites pass; anything else stores NULL.
 */
function extractCharacterId(context: LogContext | undefined): bigint | null {
  const raw = context?.characterId;
  if (raw === null || raw === undefined) return null;
  try {
    if (typeof raw === 'bigint') return raw;
    if (typeof raw === 'number' && Number.isInteger(raw)) return BigInt(raw);
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return BigInt(raw);
  } catch {
    // fall through to null
  }
  return null;
}

// Best-effort: logging must never throw, and the DB may be the very thing that's
// down — so a failed insert is swallowed (the line already went to stdout).
async function persist(
  level: 'error' | 'fatal',
  source: ErrorSource,
  message: string,
  context: LogContext | undefined,
): Promise<void> {
  try {
    await db.insert(apErrorLog).values({
      occurredAt: new Date(),
      level,
      source,
      message,
      characterId: extractCharacterId(context),
      context: scrubContext(context) ?? null,
    });
    metrics.incrementCounter(ERROR_LOG_EVENTS_TOTAL, { source });
  } catch {
    // swallow
  }
}

function makeLogger(source: ErrorSource): Logger {
  const pl = base.child({ source });
  return {
    debug: (message, context) => pl.debug(context ?? {}, message),
    info: (message, context) => pl.info(context ?? {}, message),
    warn: (message, context) => pl.warn(context ?? {}, message),
    error: (message, context) => {
      pl.error(context ?? {}, message);
      void persist('error', source, message, context);
    },
    fatal: (message, context) => {
      pl.fatal(context ?? {}, message);
      void persist('fatal', source, message, context);
    },
  };
}

/** Default server-path logger (`source='server'`) for request/action code. */
export const logger = makeLogger('server');

/** Bind a logger to a specific `error_source` (e.g. `getLogger('job')`). */
export function getLogger(source: ErrorSource): Logger {
  return makeLogger(source);
}
