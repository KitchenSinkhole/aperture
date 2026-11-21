// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apCorporation,
  apInstance,
  apInstanceOwner,
  apMap,
  apMapApiToken,
  apMapEvent,
  apUser,
} from '@/db/schema';
import { GET as killsGET } from '@/app/api/v1/kills/route';
import { GET as massLogGET } from '@/app/api/v1/mass-log/route';
import { GET as mapGET, OPTIONS as mapOPTIONS } from '@/app/api/v1/map/route';
import { GET as notesGET } from '@/app/api/v1/notes/route';
import { GET as pilotsGET } from '@/app/api/v1/pilots/route';
import { GET as signaturesGET } from '@/app/api/v1/signatures/route';
import { GET as tokenGET } from '@/app/api/v1/token/route';
import {
  clearUserApiAuthCache,
  invalidateUserApiAccount,
  invalidateUserApiMap,
  invalidateUserApiToken,
} from '@/lib/userApi/authorize';
import { clearUserApiProjections } from '@/lib/userApi/cache';
import { userApiRoute } from '@/lib/userApi/handler';
import { invalidateUserApiInstanceSwitch } from '@/lib/userApi/instance';
import { __resetUserApiRateLimit } from '@/lib/userApi/rateLimit';
import { generateUserApiToken } from '@/lib/userApi/token';
import { __pendingUserApiUsage, __resetUserApiUsage } from '@/lib/userApi/usage';
import type { ApiScope } from '@/types';
import { apertureConfig } from '../../aperture.config';

/**
 * The `/api/v1/*` HTTP surface end to end against real Postgres: each route
 * handler is called directly, so every request runs the whole wrapper
 * pipeline (instance switch, IP gate, decide, rate limit, scope, serve).
 *
 * The clock is pinned with a Date-only fake timer to the start of a rate
 * window, so a limiter window never rolls mid-test. `ap_instance` is a live
 * singleton: its access mode and user API switch are snapshotted and
 * restored. Ids use a 9734xxxx block.
 *
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test user-api
 */
const run = process.env.RUN_DB_TESTS === '1';

// Only the operator's switch action reads a session; the routes never do.
let currentSession: Session | null = null;
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => currentSession) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Keeps the forced serve failure below out of the shared `ap_error_log`.
const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/log/logger', () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: logError, fatal: vi.fn() };
  return { logger: log, getLogger: () => log };
});

const { adminSetUserApiEnabled } = await import('@/app/(admin)/actions/settings');

const CORP = 97349001n;
const MAIN = 97340001n;
const ADMIN = 97340002n;
const MAP_NAME = 'User API HTTP Map';
const ALL_SCOPES: ApiScope[] = ['map', 'signatures', 'pilots', 'notes', 'mass_log', 'kills'];

const W = apertureConfig.USER_API_RATE_WINDOW_MS;
const PER_TOKEN = apertureConfig.USER_API_MAX_PER_TOKEN;
const HOT = apertureConfig.USER_API_HOT_WINDOW_REJECTS;
const AUTH_FAILURES = apertureConfig.USER_API_MAX_AUTH_FAILURES_PER_IP;

type Handler = (request: NextRequest, ctx: unknown) => Promise<Response>;

let userId = 0;
let adminUserId = 0;
let mapId = 0n;
let fullTokenId = 0n;
let full = '';
let narrow = '';
let instanceSnapshot: typeof apInstance.$inferSelect | undefined;
let clock = 0;

function call(
  handler: Handler,
  path: string,
  init: { token?: string; authorization?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.authorization !== undefined) headers.authorization = init.authorization;
  else if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  return handler(new NextRequest(`http://localhost${path}`, { headers }), {
    params: Promise.resolve({}),
  });
}

async function mintToken(scopes: ApiScope[]): Promise<{ id: bigint; token: string }> {
  const { token, hash, prefix } = generateUserApiToken();
  const [row] = await db
    .insert(apMapApiToken)
    .values({ mapId, userId, tokenHash: hash, tokenPrefix: prefix, label: 'http tool', scopes })
    .returning({ id: apMapApiToken.id });
  return { id: row!.id, token };
}

function resetInProcessState(): void {
  __resetUserApiRateLimit();
  __resetUserApiUsage();
  clearUserApiProjections();
  clearUserApiAuthCache();
  invalidateUserApiInstanceSwitch();
}

describe.skipIf(!run)('User API HTTP surface (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
    [instanceSnapshot] = await db.select().from(apInstance).where(eq(apInstance.id, 1));
    await cleanup();

    // The test corp owns the instance, so the main passes the login gate and
    // each refusal below has exactly one cause.
    await db
      .insert(apInstance)
      .values({ id: 1, accessMode: 'restricted', userApiEnabled: true })
      .onConflictDoUpdate({
        target: apInstance.id,
        set: { accessMode: 'restricted', userApiEnabled: true },
      });
    await db
      .insert(apInstanceOwner)
      .values({ principalKind: 'corporation', principalId: CORP })
      .onConflictDoNothing();
    await db.insert(apCorporation).values({ id: CORP, name: 'User API HTTP Corp' });
    const [u] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    userId = u!.id;
    await db.insert(apCharacter).values({
      id: MAIN,
      userId,
      name: 'User API HTTP Main',
      ownerHash: 'user-api-http-hash',
      authzLevel: 'member',
      corporationId: CORP,
      allianceId: null,
      status: 'active',
    });
    const [a] = await db.insert(apUser).values({}).returning({ id: apUser.id });
    adminUserId = a!.id;
    await db.insert(apCharacter).values({
      id: ADMIN,
      userId: adminUserId,
      name: 'User API HTTP Admin',
      ownerHash: 'user-api-http-admin-hash',
      authzLevel: 'admin',
      corporationId: CORP,
      allianceId: null,
      status: 'active',
    });
    currentSession = {
      characterId: ADMIN.toString(),
      user: { id: String(adminUserId) },
    } as unknown as Session;
    const [m] = await db
      .insert(apMap)
      .values({ name: MAP_NAME, scope: 'wh', type: 'corp', ownerCorporationId: CORP })
      .returning({ id: apMap.id });
    mapId = m!.id;
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    clock = Math.ceil(Date.now() / W) * W + 1_000;
    vi.setSystemTime(clock);
    resetInProcessState();

    await db.delete(apMapEvent).where(eq(apMapEvent.mapId, mapId));
    await db.delete(apMapApiToken).where(eq(apMapApiToken.mapId, mapId));
    await db
      .update(apMap)
      .set({ apiEnabled: true, apiScopes: ALL_SCOPES, deletedAt: null })
      .where(eq(apMap.id, mapId));
    await db
      .update(apUser)
      .set({ mainCharacterId: MAIN, apiBlockedAt: null, apiBlockedUntil: null, apiBlockReason: null })
      .where(eq(apUser.id, userId));

    const minted = await mintToken(ALL_SCOPES);
    fullTokenId = minted.id;
    full = minted.token;
    narrow = (await mintToken(['map'])).token;
  });

  afterEach(() => {
    resetInProcessState();
    vi.useRealTimers();
  });

  afterAll(async () => {
    resetInProcessState();
    await cleanup();
    if (instanceSnapshot) {
      await db
        .update(apInstance)
        .set({
          accessMode: instanceSnapshot.accessMode,
          userApiEnabled: instanceSnapshot.userApiEnabled,
        })
        .where(eq(apInstance.id, 1));
    }
    await pool.end();
  });

  it.each([
    ['token', tokenGET],
    ['map', mapGET],
    ['signatures', signaturesGET],
    ['pilots', pilotsGET],
    ['notes', notesGET],
    ['mass-log', massLogGET],
    ['kills', killsGET],
  ] as const)('serves /api/v1/%s with the envelope and the contract headers', async (path, handler) => {
    const res = await call(handler, `/api/v1/${path}`, { token: full });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true });
    expect(body).toHaveProperty('data');
    expect(typeof body.generatedAt).toBe('string');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('ratelimit-limit')).toBe(String(PER_TOKEN));
    expect(res.headers.get('ratelimit-remaining')).toBe(String(PER_TOKEN - 1));
    expect(Number(res.headers.get('ratelimit-reset'))).toBeGreaterThan(0);
    expect(res.headers.get('etag')).toMatch(/^W\/"/);
  });

  it('reports the token, its granted and effective scopes and its limits', async () => {
    await db.update(apMap).set({ apiScopes: ['map', 'notes'] }).where(eq(apMap.id, mapId));
    invalidateUserApiMap(mapId);
    const body = await (await call(tokenGET, '/api/v1/token', { token: full })).json();
    expect(body.data).toEqual({
      map: { id: mapId.toString(), name: MAP_NAME },
      scopes: { granted: ALL_SCOPES, effective: ['map', 'notes'] },
      expiresAt: null,
      rateLimit: {
        perToken: PER_TOKEN,
        perAccount: apertureConfig.USER_API_MAX_PER_ACCOUNT,
        windowSeconds: W / 1000,
      },
    });
  });

  it('answers 304 to a matching If-None-Match, and still charges the request', async () => {
    const first = await call(mapGET, '/api/v1/map', { token: full });
    const etag = first.headers.get('etag')!;
    const second = await call(mapGET, '/api/v1/map', {
      token: full,
      headers: { 'if-none-match': `W/"other", ${etag}` },
    });
    expect(second.status).toBe(304);
    expect(second.headers.get('etag')).toBe(etag);
    expect(await second.text()).toBe('');
    expect(second.headers.get('ratelimit-remaining')).toBe(String(PER_TOKEN - 2));

    const stale = await call(mapGET, '/api/v1/map', {
      token: full,
      headers: { 'if-none-match': 'W/"other"' },
    });
    expect(stale.status).toBe(200);
  });

  it('narrows the mass log to one connection and keeps the envelope', async () => {
    const res = await call(massLogGET, '/api/v1/mass-log?connection=123', { token: full });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, data: [] });
  });

  it.each([
    ['missing', undefined],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['malformed', 'Bearer apu_tooshort'],
    ['unknown', `Bearer ${generateUserApiToken().token}`],
  ])('answers 401 for a %s token', async (_label, authorization) => {
    const res = await call(mapGET, '/api/v1/map', { authorization });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect(await res.json()).toEqual({ ok: false, error: expect.any(String), code: 'invalid_token' });
  });

  it('answers 401 once the token is revoked', async () => {
    expect((await call(mapGET, '/api/v1/map', { token: full })).status).toBe(200);
    await db
      .update(apMapApiToken)
      .set({ revokedAt: new Date(), revokedReason: 'creator' })
      .where(eq(apMapApiToken.id, fullTokenId));
    invalidateUserApiToken(fullTokenId);
    const res = await call(mapGET, '/api/v1/map', { token: full });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('invalid_token');
  });

  it('does not block the IP for a revoked token that keeps polling', async () => {
    await db
      .update(apMapApiToken)
      .set({ revokedAt: new Date(), revokedReason: 'creator' })
      .where(eq(apMapApiToken.id, fullTokenId));
    invalidateUserApiToken(fullTokenId);
    for (let i = 0; i <= AUTH_FAILURES; i += 1) {
      expect((await call(tokenGET, '/api/v1/token', { token: full })).status).toBe(401);
    }
    expect((await call(tokenGET, '/api/v1/token', { token: narrow })).status).toBe(200);
  });

  it.each([
    ['unknown tokens', async () => generateUserApiToken().token],
    [
      'a token the abuse ladder revoked',
      async () => {
        await db
          .update(apMapApiToken)
          .set({ revokedAt: new Date(), revokedReason: 'abuse' })
          .where(eq(apMapApiToken.id, fullTokenId));
        invalidateUserApiToken(fullTokenId);
        return full;
      },
    ],
  ])('blocks the IP past the failed-auth limit for %s', async (_label, presented) => {
    const token = await presented();
    for (let i = 0; i <= AUTH_FAILURES; i += 1) {
      expect((await call(tokenGET, '/api/v1/token', { token })).status).toBe(401);
    }
    const res = await call(tokenGET, '/api/v1/token', { token: narrow });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('never takes authority from a cookie', async () => {
    const res = await call(mapGET, '/api/v1/map', {
      headers: { cookie: 'authjs.session-token=anything; __Secure-authjs.session-token=anything' },
    });
    expect(res.status).toBe(401);
  });

  it('answers 401 for a token whose map was just soft-deleted', async () => {
    expect((await call(tokenGET, '/api/v1/token', { token: full })).status).toBe(200);
    await db.update(apMap).set({ deletedAt: new Date() }).where(eq(apMap.id, mapId));
    const res = await call(mapGET, '/api/v1/map', { token: full });
    expect(res.status).toBe(401);
    expect(res.headers.get('ratelimit-limit')).toBeNull();
    expect(res.headers.get('ratelimit-remaining')).toBeNull();
    expect(res.headers.get('ratelimit-reset')).toBeNull();
    expect((await res.json()).code).toBe('invalid_token');
  });

  it('answers a JSON 500 with the API headers when serving fails on a live map', async () => {
    const { GET } = userApiRoute('token', null, async () => {
      throw new Error('forced serve failure');
    });
    const res = await call(GET, '/api/v1/token', { token: full });
    expect(res.status).toBe(500);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('ratelimit-limit')).toBe(String(PER_TOKEN));
    expect(await res.json()).toEqual({ ok: false, error: expect.any(String), code: 'server_error' });
    expect(logError).toHaveBeenCalledWith(
      'user API serve failed',
      expect.objectContaining({ endpoint: 'token' }),
    );
  });

  it('answers 403 account_blocked', async () => {
    await db
      .update(apUser)
      .set({ apiBlockedAt: new Date(clock), apiBlockedUntil: null, apiBlockReason: 'test' })
      .where(eq(apUser.id, userId));
    invalidateUserApiAccount(userId);
    const res = await call(mapGET, '/api/v1/map', { token: full });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('account_blocked');
  });

  it('answers 403 token_suspended with Retry-After', async () => {
    await db
      .update(apMapApiToken)
      .set({ suspendedUntil: new Date(clock + 90_000) })
      .where(eq(apMapApiToken.id, fullTokenId));
    invalidateUserApiToken(fullTokenId);
    const res = await call(mapGET, '/api/v1/map', { token: full });
    expect(res.status).toBe(403);
    expect(res.headers.get('retry-after')).toBe('90');
    expect((await res.json()).code).toBe('token_suspended');
  });

  it('answers 403 api_disabled', async () => {
    await db.update(apMap).set({ apiEnabled: false }).where(eq(apMap.id, mapId));
    invalidateUserApiMap(mapId);
    const res = await call(mapGET, '/api/v1/map', { token: full });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('api_disabled');
  });

  it('answers 403 access_lost', async () => {
    await db.update(apUser).set({ mainCharacterId: null }).where(eq(apUser.id, userId));
    invalidateUserApiAccount(userId);
    const res = await call(mapGET, '/api/v1/map', { token: full });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('access_lost');
  });

  it('answers 403 scope_not_granted for a scope the token lacks', async () => {
    const res = await call(signaturesGET, '/api/v1/signatures', { token: narrow });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('scope_not_granted');
  });

  it('answers 429 with Retry-After past the per-token cap', async () => {
    for (let i = 0; i < PER_TOKEN; i++) {
      expect((await call(tokenGET, '/api/v1/token', { token: full })).status).toBe(200);
    }
    const res = await call(tokenGET, '/api/v1/token', { token: full });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe(String(W / 1000 - 1));
    expect(res.headers.get('ratelimit-remaining')).toBe('0');
    expect((await res.json()).code).toBe('rate_limited');
  });

  it('charges the rate budget before checking the scope', async () => {
    const refused = await call(signaturesGET, '/api/v1/signatures', { token: narrow });
    expect(refused.status).toBe(403);
    expect(refused.headers.get('ratelimit-remaining')).toBe(String(PER_TOKEN - 1));
    expect(__pendingUserApiUsage()).toBe(1);

    for (let i = 1; i < PER_TOKEN; i++) {
      expect((await call(signaturesGET, '/api/v1/signatures', { token: narrow })).status).toBe(403);
    }
    const limited = await call(signaturesGET, '/api/v1/signatures', { token: narrow });
    expect(limited.status).toBe(429);
  });

  it('suspends a token that keeps sending after being refused', async () => {
    for (let window = 0; window < apertureConfig.USER_API_STRIKE_HOT_WINDOWS; window++) {
      vi.setSystemTime(clock + window * W);
      for (let i = 0; i < PER_TOKEN + HOT; i++) await call(tokenGET, '/api/v1/token', { token: full });
    }

    let suspendedUntil: Date | null = null;
    for (let attempt = 0; attempt < 50 && suspendedUntil === null; attempt++) {
      const [row] = await db
        .select({ suspendedUntil: apMapApiToken.suspendedUntil })
        .from(apMapApiToken)
        .where(eq(apMapApiToken.id, fullTokenId));
      suspendedUntil = row!.suspendedUntil;
      if (suspendedUntil === null) await new Promise((r) => setTimeout(r, 100));
    }
    expect(suspendedUntil).not.toBeNull();

    const res = await call(tokenGET, '/api/v1/token', { token: full });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('token_suspended');
  });

  it('answers a CORS preflight', async () => {
    const res = await call(mapOPTIONS, '/api/v1/map');
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('answers 404 for the whole group while the instance switch is off', async () => {
    // Served once first, so the switch is cached and only the action's invalidation can flip it.
    expect((await call(mapGET, '/api/v1/map', { token: full })).status).toBe(200);
    expect(await adminSetUserApiEnabled({ enabled: false })).toEqual({ ok: true });
    try {
      for (const [handler, path] of [
        [tokenGET, '/api/v1/token'],
        [mapGET, '/api/v1/map'],
        [massLogGET, '/api/v1/mass-log'],
        [mapOPTIONS, '/api/v1/map'],
      ] as const) {
        expect((await call(handler, path, { token: full })).status).toBe(404);
      }
      expect((await call(mapGET, '/api/v1/map')).status).toBe(404);
    } finally {
      expect(await adminSetUserApiEnabled({ enabled: true })).toEqual({ ok: true });
    }
    expect((await call(mapGET, '/api/v1/map', { token: full })).status).toBe(200);
  });
});

async function cleanup() {
  await db.delete(apMap).where(eq(apMap.name, MAP_NAME));
  await db
    .delete(apInstanceOwner)
    .where(and(eq(apInstanceOwner.principalKind, 'corporation'), eq(apInstanceOwner.principalId, CORP)));
  const users = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(inArray(apCharacter.id, [MAIN, ADMIN]));
  await db.delete(apCharacter).where(inArray(apCharacter.id, [MAIN, ADMIN]));
  const userIds = [...new Set([...users.map((u) => u.userId), userId, adminUserId])].filter(
    (id) => id !== 0,
  );
  if (userIds.length > 0) await db.delete(apUser).where(inArray(apUser.id, userIds));
  await db.delete(apCorporation).where(eq(apCorporation.id, CORP));
}
