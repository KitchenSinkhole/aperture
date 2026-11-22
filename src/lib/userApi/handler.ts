import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { db } from '@/db/client';
import { apiScope, apMap } from '@/db/schema';
import { clientIpOfRequest } from '@/lib/http/clientKey';
import { getLogger } from '@/lib/log/logger';
import { withApiMetrics } from '@/lib/metrics/httpInstrumentation';
import { recordUserApiRequest } from '@/lib/metrics/registry';
import type {
  ApiScope,
  BlackoutViewer,
  UserApiEndpoint,
  UserApiErrorCode,
  UserApiRequestOutcome,
  UserApiResource,
  UserApiRouteHandlers,
  UserApiServe,
  UserApiServed,
  UserApiTokenInfo,
  UserApiTokenRecord,
} from '@/types';
import { apertureConfig } from '../../../aperture.config';
import { applyUserApiStrike } from './abuse';
import {
  authorizeUserApiBearer,
  checkUserApiScope,
  effectiveUserApiScopes,
  invalidateUserApiMap,
} from './authorize';
import { getUserApiProjection } from './cache';
import { isUserApiInstanceEnabled } from './instance';
import { checkUserApiIp, consumeUserApiRequest, noteUserApiSuspendedRequest, recordUserApiAuthFailure } from './rateLimit';
import { recordUserApiUsage } from './usage';

/**
 * The one wrapper every `/api/v1/*` route exports through. It runs the request
 * pipeline in its contracted order: instance switch, IP gate, parse / resolve /
 * decide, rate limit, scope, serve. Rate limiting precedes the scope check so
 * a tool hammering a scope it does not hold is still limited and still accrues
 * strikes.
 *
 * Authority comes from the `Authorization: Bearer` header alone. Nothing here
 * reads a cookie or a session, which is what makes the open CORS policy safe.
 */

const BASE_HEADERS: Record<string, string> = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex',
  'access-control-allow-origin': '*',
  'access-control-expose-headers':
    'ETag, Retry-After, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, WWW-Authenticate',
};

const ERROR_TEXT: Record<UserApiErrorCode, string> = {
  invalid_token: 'The bearer token is missing, malformed, unknown, revoked or expired.',
  account_blocked: "API access for this token's account is blocked.",
  token_suspended: 'This token is suspended for sending requests after being told to stop.',
  api_disabled: "This map's API is turned off.",
  access_lost: "This token's owner can no longer view the map.",
  rate_limited: 'Too many requests. Wait for Retry-After before sending another.',
  scope_not_granted: 'This token may not read this resource.',
  server_error: 'The server failed to build this response. Retry later.',
};

const log = getLogger('server');

type RateHeaders = Record<string, string>;

function failure(
  status: number,
  code: UserApiErrorCode,
  extra: { retryAfterSec?: number; headers?: RateHeaders } = {},
): Response {
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    ...extra.headers,
    'content-type': 'application/json',
  };
  if (extra.retryAfterSec !== undefined) headers['retry-after'] = String(extra.retryAfterSec);
  if (status === 401) headers['www-authenticate'] = 'Bearer';
  return new Response(JSON.stringify({ ok: false, error: ERROR_TEXT[code], code }), {
    status,
    headers,
  });
}

function notFound(): Response {
  return new Response(JSON.stringify({ ok: false, error: 'Not found.' }), {
    status: 404,
    headers: { ...BASE_HEADERS, 'content-type': 'application/json' },
  });
}

function finish(
  endpoint: UserApiEndpoint,
  outcome: UserApiRequestOutcome,
  response: Response,
): Response {
  recordUserApiRequest(endpoint, outcome);
  return response;
}

/**
 * Whether a 401 counts towards the IP's failed-auth block: a malformed or
 * unknown token does, and so does one the abuse ladder revoked, so a tool that
 * keeps hammering past strike 3 still walks its IP up the block steps. Any
 * other known token that is revoked, expired or on a deleted map is one stale
 * client, and blocking its IP would lock out every other token behind it.
 */
function countsAsFailedAuth(record: UserApiTokenRecord | null): boolean {
  return record === null || record.token.revokedReason === 'abuse';
}

function unauthorized(ip: string, endpoint: UserApiEndpoint, failedAuth: boolean): Response {
  if (failedAuth) recordUserApiAuthFailure(ip);
  return finish(endpoint, 'unauthorized', failure(401, 'invalid_token'));
}

/** True when an `If-None-Match` value names `etag`, by weak comparison. */
function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, '');
  const target = opaque(etag);
  return ifNoneMatch
    .split(',')
    .some((candidate) => candidate.trim() === '*' || opaque(candidate) === target);
}

function weakEtag(value: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(value)).digest('base64url');
  return `W/"${digest.slice(0, 27)}"`;
}

async function isMapLive(mapId: bigint): Promise<boolean> {
  const [row] = await db
    .select({ id: apMap.id })
    .from(apMap)
    .where(and(eq(apMap.id, mapId), isNull(apMap.deletedAt)))
    .limit(1);
  return row !== undefined;
}

function viewerOf(record: UserApiTokenRecord): BlackoutViewer {
  // `decideUserApiAccess` allows only a record whose access was evaluated.
  if (record.access === null) throw new Error('User API: allowed token has no evaluated access.');
  return record.access.blackout;
}

async function handle(
  request: NextRequest,
  endpoint: UserApiEndpoint,
  scope: ApiScope | null,
  serve: UserApiServe,
): Promise<Response> {
  if (!(await isUserApiInstanceEnabled())) return notFound();

  const ip = clientIpOfRequest(request.headers);
  const gate = checkUserApiIp(ip);
  if (!gate.ok) {
    return finish(
      endpoint,
      'rate_limited',
      failure(429, 'rate_limited', { retryAfterSec: gate.retryAfterSec }),
    );
  }

  const decision = await authorizeUserApiBearer(request.headers.get('authorization'));
  if (!decision.ok) {
    if (decision.status === 401) {
      return unauthorized(ip, endpoint, countsAsFailedAuth(decision.record));
    }
    if (decision.code === 'token_suspended' && decision.record !== null) {
      const tokenId = decision.record.token.id;
      if (noteUserApiSuspendedRequest(tokenId)) void applyUserApiStrike(tokenId);
    }
    return finish(
      endpoint,
      'forbidden',
      failure(403, decision.code, { retryAfterSec: decision.retryAfterSec }),
    );
  }

  const { record } = decision;
  const tokenId = record.token.id;
  const rate = consumeUserApiRequest(tokenId, record.account.userId);
  const rateHeaders: RateHeaders = {
    'ratelimit-limit': String(rate.limit),
    'ratelimit-remaining': String(rate.remaining),
    'ratelimit-reset': String(rate.resetSec),
  };
  if (!rate.ok) {
    if (rate.strike) void applyUserApiStrike(tokenId);
    return finish(
      endpoint,
      'rate_limited',
      failure(429, 'rate_limited', { retryAfterSec: rate.retryAfterSec, headers: rateHeaders }),
    );
  }
  recordUserApiUsage(tokenId);

  if (scope !== null) {
    const allowed = checkUserApiScope(record, scope);
    if (!allowed.ok) {
      return finish(endpoint, 'forbidden', failure(403, allowed.code, { headers: rateHeaders }));
    }
  }

  let served: UserApiServed;
  try {
    served = await serve(request, record);
  } catch (err) {
    // A map deleted while its tokens' records are still cached is a dead
    // token, not a server error. A failed liveness read is the same outage
    // that failed the serve, so it answers 500 too.
    const live = await isMapLive(record.map.id).catch(() => true);
    if (!live) {
      invalidateUserApiMap(record.map.id);
      return unauthorized(ip, endpoint, false);
    }
    log.error('user API serve failed', { endpoint, mapId: record.map.id.toString(), err });
    return finish(
      endpoint,
      'error',
      failure(500, 'server_error', { headers: rateHeaders }),
    );
  }

  const etagHeader: Record<string, string> = served.etag === null ? {} : { etag: served.etag };
  if (served.etag !== null && etagMatches(request.headers.get('if-none-match'), served.etag)) {
    return finish(
      endpoint,
      'not_modified',
      new Response(null, { status: 304, headers: { ...BASE_HEADERS, ...rateHeaders, ...etagHeader } }),
    );
  }
  return finish(
    endpoint,
    'ok',
    new Response(served.body, {
      status: 200,
      headers: {
        ...BASE_HEADERS,
        ...rateHeaders,
        ...etagHeader,
        'content-type': 'application/json',
      },
    }),
  );
}

async function preflight(): Promise<Response> {
  if (!(await isUserApiInstanceEnabled())) return notFound();
  return new Response(null, {
    status: 204,
    headers: {
      ...BASE_HEADERS,
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Authorization, If-None-Match',
      'access-control-max-age': '600',
    },
  });
}

/**
 * The `GET` and `OPTIONS` exports of one `/api/v1/<endpoint>` route. `scope`
 * is the scope the endpoint reads, or null for one any live token may call.
 */
export function userApiRoute(
  endpoint: UserApiEndpoint,
  scope: ApiScope | null,
  serve: UserApiServe,
): UserApiRouteHandlers {
  const template = `/api/v1/${endpoint}`;
  return {
    GET: withApiMetrics(template, (request: NextRequest) => handle(request, endpoint, scope, serve)),
    OPTIONS: withApiMetrics(template, () => preflight()),
  };
}

/** Serves one cached projection resource unchanged. */
export function serveUserApiProjection(resource: UserApiResource): UserApiServe {
  return async (_request, record) => {
    const entry = await getUserApiProjection(record.map.id, resource, viewerOf(record));
    return { body: entry.body, etag: entry.etag };
  };
}

/** Serves the mass log, narrowed to one connection by `?connection=<id>` when given. */
export const serveUserApiMassLog: UserApiServe = async (request, record) => {
  const entry = await getUserApiProjection(record.map.id, 'mass_log', viewerOf(record));
  const connectionId = request.nextUrl.searchParams.get('connection');
  if (connectionId === null) return { body: entry.body, etag: entry.etag };

  const payload = {
    data: entry.payload.data.filter((e) => e.connectionId === connectionId),
    ...(entry.payload.hidden ? { hidden: true as const } : {}),
  };
  return {
    body: JSON.stringify({ ok: true, ...payload, generatedAt: entry.generatedAt }),
    etag: weakEtag(payload),
  };
};

function killsSince(raw: string | null, now: number): number {
  const floor = now - apertureConfig.USER_API_KILLS_MAX_AGE_DAYS * 86_400_000;
  const parsed = raw === null ? Number.NaN : Date.parse(raw);
  const since = Number.isNaN(parsed) ? now - apertureConfig.USER_API_KILLS_DEFAULT_SINCE_MS : parsed;
  return Math.min(Math.max(since, floor), now);
}

function killsLimit(raw: string | null): number {
  const max = apertureConfig.USER_API_KILLS_MAX_LIMIT;
  const parsed = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
  if (!Number.isFinite(parsed)) return max;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}

/**
 * Serves cached kills newer than `?since=<ISO>` (default 24 hours back, floor
 * 7 days), newest first, at most `?limit=` (default and maximum 200). An
 * unparseable value takes its default and an out-of-range one its nearest
 * bound; neither is refused.
 */
export const serveUserApiKills: UserApiServe = async (request, record) => {
  const entry = await getUserApiProjection(record.map.id, 'kills', viewerOf(record));
  const params = request.nextUrl.searchParams;
  const since = killsSince(params.get('since'), Date.now());
  const limit = killsLimit(params.get('limit'));
  const payload = {
    data: entry.payload.data.filter((k) => Date.parse(k.killmailTime) >= since).slice(0, limit),
  };
  return {
    body: JSON.stringify({ ok: true, ...payload, generatedAt: entry.generatedAt }),
    etag: weakEtag(payload),
  };
};

/** Serves what the presented token is and what it may do right now. */
export const serveUserApiToken: UserApiServe = async (_request, record) => {
  const data: UserApiTokenInfo = {
    map: { id: record.map.id.toString(), name: record.map.name },
    scopes: {
      granted: apiScope.enumValues.filter((s) => record.token.scopes.includes(s)),
      effective: effectiveUserApiScopes(record),
    },
    expiresAt: record.token.expiresAt === null ? null : record.token.expiresAt.toISOString(),
    rateLimit: {
      perToken: apertureConfig.USER_API_MAX_PER_TOKEN,
      perAccount: apertureConfig.USER_API_MAX_PER_ACCOUNT,
      windowSeconds: apertureConfig.USER_API_RATE_WINDOW_MS / 1000,
    },
  };
  return {
    body: JSON.stringify({ ok: true, data, generatedAt: new Date().toISOString() }),
    etag: weakEtag(data),
  };
};
