import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { apertureConfig } from '../../../aperture.config';
import { db } from '@/db/client';
import { apCharacter } from '@/db/schema';
import { env } from '@/lib/env';
import { decryptToken } from '@/lib/crypto';
import { refreshAccessToken } from '@/lib/auth/eve-provider';
import { OP_KEYS, type OpKey } from './opkeys';
import { resolveRoute } from './routes';
import { canRequest, recordFailure, recordSuccess } from './breaker';
import { inDowntimeWindow } from './downtime';
import { recordEsiRequest } from '@/lib/metrics/registry';
import { getLogger } from '@/lib/log/logger';
import type { EsiMetricOutcome } from '@/types';

// ESI runs in the background worker (location-poll) and in Next request paths;
// `job` is the dominant source for these diagnostics.
const esiLog = getLogger('job');

/**
 * The ESI client substrate.
 *
 * `esiCall` is the one entrypoint: it dispatches an opKey (resolved to a swagger
 * method/path via `routes.ts`), attaches a character bearer token when the op
 * requires one, gates on a per-endpoint circuit breaker, issues the request
 * with a hard timeout, honours ESI error-limit headers, tolerates the CCP
 * downtime window, and decodes the response through a caller-supplied Zod
 * schema. Empty-body 2xx responses (204 from write ops like `setWaypoint`)
 * decode as `null` — those callers pass `schema: z.null()`. It contains no
 * business logic — Stages 7/10/12/13 build on it.
 *
 * Failure modes are distinct typed errors so callers can branch:
 *   - `EsiBreakerOpenError` — endpoint breaker is open; request was not sent.
 *   - `EsiDowntimeError`     — failed inside the CCP downtime window (expected).
 *   - `EsiRateLimitError`    — ESI error budget exhausted; carries reset seconds.
 *   - `EsiHttpError`         — non-2xx / network / timeout (counted by breaker).
 *   - `EsiDecodeError`       — 2xx body failed Zod validation (schema drift).
 *   - `EsiTokenError`        — character-authed call couldn't resolve a token
 *                              (missing row, refresh failed, decryption failed).
 */

export class EsiBreakerOpenError extends Error {
  constructor(public readonly operationId: string) {
    super(`ESI circuit breaker open for ${operationId}`);
    this.name = 'EsiBreakerOpenError';
  }
}

export class EsiDowntimeError extends Error {
  constructor(public readonly operationId: string) {
    super(`ESI request failed during CCP downtime window for ${operationId}`);
    this.name = 'EsiDowntimeError';
  }
}

export class EsiRateLimitError extends Error {
  constructor(
    public readonly operationId: string,
    public readonly resetSeconds: number,
  ) {
    super(`ESI error limit exhausted for ${operationId}; resets in ${resetSeconds}s`);
    this.name = 'EsiRateLimitError';
  }
}

export class EsiHttpError extends Error {
  constructor(
    public readonly operationId: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`ESI request to ${operationId} failed: ${status}`);
    this.name = 'EsiHttpError';
  }
}

export class EsiDecodeError extends Error {
  constructor(
    public readonly operationId: string,
    public readonly cause: unknown,
  ) {
    super(`ESI response for ${operationId} failed validation`);
    this.name = 'EsiDecodeError';
  }
}

export class EsiTokenError extends Error {
  /**
   * Raised when a character-authed call can't resolve a usable access token —
   * either the row has no stored token, the refresh-token exchange failed, or
   * decryption blew up. The location-poll uses this to stop polling
   * a character whose token has gone bad; re-enabling tracking later requires
   * the user to re-authenticate.
   */
  constructor(
    public readonly characterId: bigint,
    public readonly cause?: unknown,
  ) {
    const reason = cause instanceof Error ? cause.message : 'no usable token';
    super(`ESI token unavailable for character ${characterId}: ${reason}`);
    this.name = 'EsiTokenError';
  }
}

export interface EsiCallOptions<T> {
  /** Zod schema the 200 body is parsed through. */
  schema: z.ZodType<T>;
  /** Values substituted into `{…}` path placeholders. */
  pathParams?: Record<string, string | number | bigint>;
  /** Query-string parameters appended to the URL. */
  query?: Record<string, string | number | boolean | Array<string | number>>;
  /** Request body for POST operations (JSON-encoded). */
  body?: unknown;
  /** Required when the opKey's `auth` is `character`; resolves the bearer token. */
  characterId?: bigint;
}

/**
 * Resolve a fresh ESI access token for a character. Refreshes (rotating and
 * persisting the refresh token) when within the configured expiry buffer,
 * otherwise decrypts the stored token. Throws if the character has no token row.
 */
async function resolveCharacterToken(characterId: bigint): Promise<string> {
  const [row] = await db
    .select({
      accessToken: apCharacter.esiAccessToken,
      expires: apCharacter.esiAccessTokenExpires,
    })
    .from(apCharacter)
    .where(eq(apCharacter.id, characterId));

  if (!row?.accessToken || !row.expires) {
    throw new EsiTokenError(characterId);
  }

  const bufferMs = apertureConfig.SSO_TOKEN_REFRESH_BUFFER_S * 1000;
  if (row.expires.getTime() - bufferMs <= Date.now()) {
    return forceRefreshCharacterToken(characterId);
  }
  try {
    return decryptToken(row.accessToken);
  } catch (err) {
    throw new EsiTokenError(characterId, err);
  }
}

/**
 * Unconditionally rotate the character's access token (ignoring the expiry
 * buffer) and return it. Used as the one retry after a 401: the stored token
 * was stale or early-invalidated. A failed rotation means the refresh token
 * itself is dead — surfaced as `EsiTokenError` so the caller stops cleanly.
 */
async function forceRefreshCharacterToken(characterId: bigint): Promise<string> {
  try {
    return await refreshAccessToken(characterId);
  } catch (err) {
    throw new EsiTokenError(characterId, err);
  }
}

function buildUrl(
  path: string,
  pathParams: EsiCallOptions<unknown>['pathParams'],
  query: EsiCallOptions<unknown>['query'],
): string {
  let resolvedPath = path;
  for (const [key, value] of Object.entries(pathParams ?? {})) {
    resolvedPath = resolvedPath.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  const url = new URL(resolvedPath, env.ESI_BASE_URL);
  url.searchParams.set('datasource', apertureConfig.ESI_DATASOURCE);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (Array.isArray(value)) {
      url.searchParams.set(key, value.join(','));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** Throw `EsiRateLimitError` when ESI signals the error budget is exhausted. */
function assertErrorBudget(operationId: string, headers: Headers): void {
  const remain = headers.get('x-esi-error-limit-remain');
  if (remain !== null && Number(remain) <= 0) {
    const reset = Number(headers.get('x-esi-error-limit-reset') ?? '60');
    throw new EsiRateLimitError(operationId, Number.isFinite(reset) ? reset : 60);
  }
}

/**
 * Issue a single ESI request for an opKey and return the decoded response.
 * Wraps {@link runEsiCall} to tally `esi_requests_total{operationId,outcome}`
 * and observe `esi_request_duration_ms{operationId}`. Latency is recorded only
 * for outcomes where a request actually left the process — `breaker_open` and
 * `token_error` short-circuit before the network, so timing them would skew the
 * histogram toward zero.
 */
export async function esiCall<T>(opKey: OpKey, opts: EsiCallOptions<T>): Promise<T> {
  const operationId = OP_KEYS[opKey].operationId;
  const start = performance.now();
  try {
    const result = await runEsiCall(opKey, opts);
    recordEsiRequest(operationId, 'success', performance.now() - start);
    return result;
  } catch (err) {
    const outcome = outcomeOf(err);
    recordEsiRequest(operationId, outcome, requestLeftProcess(outcome) ? performance.now() - start : null);
    throw err;
  }
}

/** Map a thrown ESI error to its metrics outcome label. */
function outcomeOf(err: unknown): EsiMetricOutcome {
  if (err instanceof EsiBreakerOpenError) return 'breaker_open';
  if (err instanceof EsiDowntimeError) return 'downtime';
  if (err instanceof EsiRateLimitError) return 'rate_limited';
  if (err instanceof EsiDecodeError) return 'decode_error';
  if (err instanceof EsiTokenError) return 'token_error';
  // EsiHttpError and any unexpected throw fold to the generic transport failure.
  return 'http_error';
}

function requestLeftProcess(outcome: EsiMetricOutcome): boolean {
  return outcome !== 'breaker_open' && outcome !== 'token_error';
}

/**
 * Issue a single ESI request for an opKey and return the decoded response.
 * See the module header for the failure-mode taxonomy.
 */
async function runEsiCall<T>(opKey: OpKey, opts: EsiCallOptions<T>): Promise<T> {
  const op = OP_KEYS[opKey];
  const route = resolveRoute(op.operationId);
  const operationId = op.operationId;

  if (!canRequest(operationId)) {
    throw new EsiBreakerOpenError(operationId);
  }

  const isAuthed = op.auth === 'character';
  if (isAuthed && opts.characterId === undefined) {
    throw new Error(`opKey "${opKey}" requires a characterId (auth: character)`);
  }

  const url = buildUrl(route.path, opts.pathParams, opts.query);

  // Authenticated calls get exactly one forced-refresh retry on a 401: the
  // stored access token was stale / early-invalidated (the recurring overnight
  // failure), so rotate it and re-issue once before giving up. A 401 is a token
  // problem, never an endpoint-health problem, so it must NOT trip the breaker.
  const maxAttempts = isAuthed ? 2 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const headers: Record<string, string> = {
      'User-Agent': env.EVE_USER_AGENT,
      'Accept-Encoding': 'gzip',
      Accept: 'application/json',
      // The unversioned ESI surface is pinned by compatibility date; without it
      // CCP defaults to 2020-01-01, which no longer matches our routes/decoders.
      'X-Compatibility-Date': apertureConfig.ESI_COMPATIBILITY_DATE,
    };
    if (isAuthed) {
      const token =
        attempt === 1
          ? await resolveCharacterToken(opts.characterId!)
          : await forceRefreshCharacterToken(opts.characterId!);
      headers.Authorization = `Bearer ${token}`;
    }

    const init: RequestInit = {
      method: route.method.toUpperCase(),
      headers,
      signal: AbortSignal.timeout(apertureConfig.ESI_REQUEST_TIMEOUT_MS),
    };
    if (route.method === 'post' && opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // Network error or timeout. Downtime failures are expected and must not
      // trip the breaker.
      if (inDowntimeWindow()) throw new EsiDowntimeError(operationId);
      recordFailure(operationId);
      throw new EsiHttpError(operationId, 0, err instanceof Error ? err.message : String(err));
    }

    if (res.ok) {
      recordSuccess(operationId);
      // Write ops (e.g. setWaypoint) answer 204 with an empty body — there's
      // nothing to decode, so read text and treat empty as `null`. Such callers
      // pass `schema: z.null()`.
      const text = await res.text();
      const json = text.length === 0 ? null : JSON.parse(text);
      const parsed = opts.schema.safeParse(json);
      if (!parsed.success) {
        throw new EsiDecodeError(operationId, parsed.error);
      }
      return parsed.data;
    }

    // A 401 on an authenticated call is a stale/invalid token, not a sick
    // endpoint — refresh once and retry, and keep it off the breaker.
    if (isAuthed && res.status === 401) {
      const body = await res.text();
      // TEMP (recurring-401 diagnosis — remove after one capture): surface the
      // exact CCP reason so we can tell a revoked `invalid_token` from an
      // expired / early-invalidated access token.
      esiLog.warn('ESI 401 on authenticated call', {
        operationId,
        characterId: opts.characterId,
        attempt,
        maxAttempts,
        body,
      });
      if (attempt < maxAttempts) continue; // force-refresh + retry once
      // Refresh succeeded but ESI still rejects the fresh token → treat as a
      // transient outage (the poll backs off and survives) rather than a dead
      // token (which would delete tracking). The endpoint breaker stays clean.
      throw new EsiHttpError(operationId, 401, body);
    }

    assertErrorBudget(operationId, res.headers);
    if (inDowntimeWindow()) throw new EsiDowntimeError(operationId);
    recordFailure(operationId);
    throw new EsiHttpError(operationId, res.status, await res.text());
  }

  // Unreachable: the loop returns on success or throws on the final attempt.
  throw new EsiTokenError(opts.characterId!);
}
