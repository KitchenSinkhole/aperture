// @vitest-environment node
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '@/db/client';
import { apErrorLog } from '@/db/schema';
import { scrubContext } from '@/lib/log/scrub';
import { getLogger } from '@/lib/log/logger';

/**
 * Covers observability phase 4:
 *  - `scrubContext` PII denylist + Error flattening (pure, always runs).
 *  - The logger's persistence path (DB-gated): `error` lands a scrubbed
 *    `ap_error_log` row; `warn` does not.
 *
 * DB-gated like the rest:
 *   docker compose up -d && pnpm db:migrate && RUN_DB_TESTS=1 pnpm test
 */
const run = process.env.RUN_DB_TESTS === '1';

describe('scrubContext (pure)', () => {
  it('redacts PII keys, keeps ids', () => {
    const out = scrubContext({
      characterId: '90000001',
      characterName: 'Secret Pilot',
      mapId: '42',
      ip: '203.0.113.7',
      nested: { email: 'a@b.c', systemId: 30000142 },
    });
    expect(out).toEqual({
      characterId: '90000001',
      characterName: '[redacted]',
      mapId: '42',
      ip: '[redacted]',
      nested: { email: '[redacted]', systemId: 30000142 },
    });
  });

  it('matches keys ignoring case and separators', () => {
    const out = scrubContext({ 'x-forwarded-for': '10.0.0.1', User_Agent: 'curl' });
    expect(out).toEqual({ 'x-forwarded-for': '[redacted]', User_Agent: '[redacted]' });
  });

  it('flattens an Error to name/message/stack', () => {
    const out = scrubContext({ err: new Error('boom') }) as { err: Record<string, unknown> };
    expect(out.err.name).toBe('Error');
    expect(out.err.message).toBe('boom');
    expect(typeof out.err.stack).toBe('string');
  });

  it('returns undefined for empty/absent input', () => {
    expect(scrubContext(undefined)).toBeUndefined();
    expect(scrubContext(null)).toBeUndefined();
    expect(scrubContext({})).toBeUndefined();
  });
});

async function waitForRow(message: string, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const rows = await db.select().from(apErrorLog).where(eq(apErrorLog.message, message));
    if (rows.length) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
  return [];
}

const PREFIX = `errlog-test-${Date.now()}-`;

describe.skipIf(!run)('error-log persistence (real Postgres)', () => {
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: 'src/db/migrations' });
  });

  afterAll(async () => {
    await db.delete(apErrorLog).where(like(apErrorLog.message, `${PREFIX}%`));
    await pool.end();
  });

  it('persists an error-level log as a scrubbed row', async () => {
    const message = `${PREFIX}error`;
    getLogger('job').error(message, { mapId: '7', characterName: 'Should Not Persist' });

    const rows = await waitForRow(message);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.level).toBe('error');
    expect(row.source).toBe('job');
    expect(row.characterId).toBeNull();
    expect(row.context).toEqual({ mapId: '7', characterName: '[redacted]' });
  });

  it('does NOT persist a warn-level log', async () => {
    const message = `${PREFIX}warn`;
    getLogger('server').warn(message, { mapId: '9' });

    // Give any (incorrect) async write a chance to land before asserting absence.
    await new Promise((r) => setTimeout(r, 400));
    const rows = await db.select().from(apErrorLog).where(eq(apErrorLog.message, message));
    expect(rows).toHaveLength(0);
  });
});
