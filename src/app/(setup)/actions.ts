'use server';

import { timingSafeEqual } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { db } from '@/db/client';
import {
  clearSetupCookie,
  readSetupCookie,
  setSetupCookie,
} from '@/lib/auth/setup-cookie';
import {
  addInstanceGrant,
  addOwner,
  type GrantPrincipalKind,
  type InstanceGrantCapability,
  type OwnerKind,
  removeGrant,
  removeOwner,
  setAccessMode,
} from '@/lib/auth/instanceConfig';
import { env } from '@/lib/env';
import { jobQueueFor, onDemandJobModules } from '@/lib/jobs/registry';
import { logger } from '@/lib/log/logger';

/**
 * Setup-wizard Server Actions. All gated except `setupUnlockAction`
 * itself: a request hitting any other action without a valid `ap_setup` cookie
 * returns `{ ok: false, error: 'Locked.' }`. The unlock check is constant-time
 * (`timingSafeEqual`) and the response is generic ("Invalid password") to
 * prevent enumeration.
 *
 * Cross-cuts:
 *   - Every gated action emits a structured `warn` log (the logger, `source='server'`)
 *     with the client's `x-forwarded-for` (if proxied) and the action name so proxy
 *     + app logs can be correlated. `warn` is stdout-only — the IP is never persisted
 *     to `ap_error_log`. No DB audit row — CLAUDE.md forbids parallel audit tables and
 *     `ap_map_event` is map-scoped.
 *   - Operator-only actions never touch `ap_map_event` and bypass realtime —
 *     the wizard isn't a map surface, it's an ops console.
 */

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

async function clientIpHint(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? '-';
}

async function logAction(name: string, extra?: Record<string, unknown>): Promise<void> {
  const ip = await clientIpHint();
  // stdout-only (warn); `ip` is for proxy/app-log correlation and never reaches
  // `ap_error_log`.
  logger.warn('setup action', { action: name, ip, ...extra });
}

async function gate(): Promise<ActionResult> {
  const unlocked = await readSetupCookie();
  if (!unlocked) return { ok: false, error: 'Locked.' };
  return { ok: true };
}

const passwordSchema = z.string().min(1, 'Password is required.').max(1000);

/**
 * Unlocks the console when the submitted password matches `SETUP_PASSWORD`.
 * Refuses to run if `SETUP_PASSWORD` is empty — a deploy that forgot to set
 * the env var must not accidentally accept any password.
 */
export async function setupUnlockAction(password: string): Promise<ActionResult> {
  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) return { ok: false, error: 'Invalid password.' };

  if (!env.SETUP_PASSWORD) {
    await logAction('unlock-refused-no-env');
    return { ok: false, error: 'Setup wizard is disabled: SETUP_PASSWORD is not configured.' };
  }

  const submitted = Buffer.from(parsed.data);
  const expected = Buffer.from(env.SETUP_PASSWORD);
  // timingSafeEqual requires equal-length buffers; pad the shorter side so the
  // comparison itself is the only branch that decides the outcome.
  const len = Math.max(submitted.length, expected.length);
  const submittedPadded = Buffer.concat([submitted, Buffer.alloc(len - submitted.length)]);
  const expectedPadded = Buffer.concat([expected, Buffer.alloc(len - expected.length)]);
  const ok =
    submitted.length === expected.length &&
    timingSafeEqual(submittedPadded, expectedPadded);
  if (!ok) {
    await logAction('unlock-failed');
    return { ok: false, error: 'Invalid password.' };
  }

  await setSetupCookie();
  await logAction('unlock-ok');
  revalidatePath('/setup');
  return { ok: true };
}

/** Clear the unlock cookie. Always returns ok; deleting a missing cookie is a no-op. */
export async function setupLogoutAction(): Promise<ActionResult> {
  await clearSetupCookie();
  await logAction('logout');
  revalidatePath('/setup');
  return { ok: true };
}

interface MigrateResult {
  applied: number;
  tags: string[];
}

interface DrizzleJournalEntry {
  idx: number;
  when: number;
  tag: string;
}

async function readJournalTags(): Promise<DrizzleJournalEntry[]> {
  const journalPath = join(process.cwd(), 'src', 'db', 'migrations', 'meta', '_journal.json');
  const raw = await readFile(journalPath, 'utf8');
  const parsed = JSON.parse(raw) as { entries?: DrizzleJournalEntry[] };
  return (parsed.entries ?? []).sort((a, b) => a.idx - b.idx);
}

async function appliedWhens(): Promise<Set<number>> {
  try {
    const result = await db.execute<{ created_at: string | number | null }>(
      sql`SELECT created_at FROM drizzle.__drizzle_migrations`,
    );
    const out = new Set<number>();
    for (const row of result.rows) {
      const v = row.created_at;
      if (v === null) continue;
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) out.add(n);
    }
    return out;
  } catch {
    // Table doesn't exist yet — first migrate run on a fresh database.
    return new Set();
  }
}

/**
 * Run pending Drizzle migrations against the configured `DATABASE_URL`.
 * Idempotent: re-running with no pending work returns `{ applied: 0, tags: [] }`.
 * Detects pending entries by diffing the journal's `when` timestamps against
 * the `drizzle.__drizzle_migrations` table before invoking the migrator.
 */
export async function setupRunMigrations(): Promise<ActionResult<MigrateResult>> {
  const gated = await gate();
  if (!gated.ok) return gated;
  await logAction('run-migrations');

  try {
    const journal = await readJournalTags();
    const before = await appliedWhens();
    const pending = journal.filter((e) => !before.has(e.when));

    await migrate(db, { migrationsFolder: 'src/db/migrations' });

    return {
      ok: true,
      data: { applied: pending.length, tags: pending.map((e) => e.tag) },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Migrate failed.' };
  }
}

interface EnqueueResult {
  /** `graphile_worker.jobs.id` as a base-10 string. */
  jobId: string;
}

async function enqueueJob(taskName: string): Promise<EnqueueResult> {
  const queueName = jobQueueFor(taskName);
  const result = await db.execute<{ id: string | number }>(
    sql`SELECT graphile_worker.add_job(${taskName}, '{}'::json, ${queueName}::text) AS id`,
  );
  const id = result.rows[0]?.id;
  return { jobId: id === undefined || id === null ? '' : String(id) };
}

/**
 * Enqueue the `sde-ingest` graphile-worker job — a re-run of the pipeline
 * against the build the database already holds. Returns the queued job id.
 */
export async function setupRunSdeIngest(): Promise<ActionResult<EnqueueResult>> {
  const gated = await gate();
  if (!gated.ok) return gated;
  await logAction('run-sde-ingest');

  try {
    return { ok: true, data: await enqueueJob('sde-ingest') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Enqueue failed.' };
  }
}

/**
 * Enqueue the `sde-refresh` graphile-worker job — the daily self-refresh path,
 * run now. Checks CCP's latest manifest and ingests it when it is newer than
 * the build the database holds; a no-op when already current.
 */
export async function setupRunSdeRefresh(): Promise<ActionResult<EnqueueResult>> {
  const gated = await gate();
  if (!gated.ok) return gated;
  await logAction('run-sde-refresh');

  try {
    return { ok: true, data: await enqueueJob('sde-refresh') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Enqueue failed.' };
  }
}

/**
 * Enqueue the `csv-ingest` graphile-worker job — re-ingests the vendored
 * wormhole CSVs only. Requires `universe_system`/`universe_type` to be
 * populated (run the SDE ingest first on a fresh database).
 */
export async function setupRunCsvIngest(): Promise<ActionResult<EnqueueResult>> {
  const gated = await gate();
  if (!gated.ok) return gated;
  await logAction('run-csv-ingest');

  try {
    return { ok: true, data: await enqueueJob('csv-ingest') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Enqueue failed.' };
  }
}

const cronOnDemandSchema = z.object({ name: z.string().min(1).max(120) });

/**
 * Enqueue a named graphile-worker task on-demand. Validates `name` against the
 * `taskRegistry` so the wizard can't enqueue arbitrary strings — the queue
 * itself rejects unknown task names, but a typed gate produces a clearer
 * error and bounds the surface to the operator subset.
 */
export async function setupRunCronOnDemand(
  name: string,
): Promise<ActionResult<EnqueueResult>> {
  const gated = await gate();
  if (!gated.ok) return gated;

  const parsed = cronOnDemandSchema.safeParse({ name });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };

  const known = new Set(onDemandJobModules().map((m) => m.name));
  if (!known.has(parsed.data.name)) {
    return { ok: false, error: `Unknown task: ${parsed.data.name}` };
  }
  await logAction('run-cron-on-demand', { name: parsed.data.name });

  try {
    return { ok: true, data: await enqueueJob(parsed.data.name) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Enqueue failed.' };
  }
}

/**
 * Instance access configuration. These actions
 * wrap `src/lib/auth/instanceConfig.ts` behind the same `gate()` as the rest of
 * the console — the operator drives the allowlist with no EVE login, the
 * bootstrap path before anyone can sign in.
 *
 * All EVE ids cross the client boundary as strings (JS numbers can't hold a
 * 64-bit id); the schemas parse a digit-string to `bigint`. Every mutation
 * `revalidatePath('/setup')` so the server-rendered config table refreshes.
 */

const eveIdSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, 'Must be a numeric EVE id.')
  .transform((s) => BigInt(s));

const accessModeSchema = z.enum(['open', 'restricted']);
const ownerKindSchema = z.enum(['corporation', 'alliance']);
const grantKindSchema = z.enum(['character', 'corporation', 'alliance', 'role']);
const grantCapabilitySchema = z.enum(['login', 'admin']);

/** Set the instance-wide access mode (`open` admits any EVE login; `restricted` gates on the allowlist). */
export async function setupSetAccessMode(mode: string): Promise<ActionResult> {
  const gated = await gate();
  if (!gated.ok) return gated;

  const parsed = accessModeSchema.safeParse(mode);
  if (!parsed.success) return { ok: false, error: 'Invalid access mode.' };
  await logAction('set-access-mode', { mode: parsed.data });

  try {
    await setAccessMode(parsed.data);
    revalidatePath('/setup');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Update failed.' };
  }
}

/** Designate an owner corporation/alliance (members may always log in; ownership does not elevate authz). */
export async function setupAddOwner(kind: string, principalId: string): Promise<ActionResult> {
  const gated = await gate();
  if (!gated.ok) return gated;

  const k = ownerKindSchema.safeParse(kind);
  const id = eveIdSchema.safeParse(principalId);
  if (!k.success) return { ok: false, error: 'Owner must be a corporation or alliance.' };
  if (!id.success) return { ok: false, error: id.error.issues[0]!.message };
  await logAction('add-owner', { kind: k.data, id: principalId });

  try {
    await addOwner(k.data as OwnerKind, id.data);
    revalidatePath('/setup');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Add failed.' };
  }
}

/** Remove an owner corporation/alliance. */
export async function setupRemoveOwner(kind: string, principalId: string): Promise<ActionResult> {
  const gated = await gate();
  if (!gated.ok) return gated;

  const k = ownerKindSchema.safeParse(kind);
  const id = eveIdSchema.safeParse(principalId);
  if (!k.success) return { ok: false, error: 'Owner must be a corporation or alliance.' };
  if (!id.success) return { ok: false, error: id.error.issues[0]!.message };
  await logAction('remove-owner', { kind: k.data, id: principalId });

  try {
    await removeOwner(k.data as OwnerKind, id.data);
    revalidatePath('/setup');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Remove failed.' };
  }
}

const addGrantSchema = z.object({
  principalKind: grantKindSchema,
  principalId: eveIdSchema,
  capability: grantCapabilitySchema,
  // datetime-local sends `YYYY-MM-DDTHH:mm`; empty string = permanent.
  expiresAt: z
    .string()
    .trim()
    .transform((s, ctx): Date | null => {
      if (s === '') return null;
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid expiry date.' });
        return z.NEVER;
      }
      return d;
    }),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((s) => (s === '' ? null : s)),
});

interface AddGrantArgs {
  principalKind: string;
  principalId: string;
  capability: string;
  expiresAt: string;
  note: string;
}

/**
 * Add an instance-scoped allowlist/admin grant. `capability='login'` is a plain
 * allowlist entry; `admin` is the super-admin hand-grant read by
 * `resolveAuthzLevel`. A non-empty `expiresAt` time-boxes the grant.
 */
export async function setupAddGrant(args: AddGrantArgs): Promise<ActionResult> {
  const gated = await gate();
  if (!gated.ok) return gated;

  const parsed = addGrantSchema.safeParse(args);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  await logAction('add-grant', {
    kind: parsed.data.principalKind,
    id: args.principalId,
    capability: parsed.data.capability,
  });

  try {
    await addInstanceGrant({
      principalKind: parsed.data.principalKind as GrantPrincipalKind,
      principalId: parsed.data.principalId,
      capability: parsed.data.capability as InstanceGrantCapability,
      expiresAt: parsed.data.expiresAt,
      note: parsed.data.note,
    });
    revalidatePath('/setup');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Add failed.' };
  }
}

/** Revoke an instance-scoped grant by its id. */
export async function setupRemoveGrant(id: string): Promise<ActionResult> {
  const gated = await gate();
  if (!gated.ok) return gated;

  const parsed = eveIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Invalid grant id.' };
  await logAction('remove-grant', { id });

  try {
    await removeGrant(parsed.data);
    revalidatePath('/setup');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Remove failed.' };
  }
}
