import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '@/lib/env';
import * as schema from './schema';

declare global {
  var __aperturePool: Pool | undefined;
}

// Unset in the long-running server/worker process (pg's own default applies).
// A short-lived child process (SDE ingest) sets this to keep its own pool small
// and dedicated rather than sizing itself like the main app's pool.
const poolMax = Number(process.env.DB_POOL_MAX) || undefined;

export const pool =
  globalThis.__aperturePool ?? new Pool({ connectionString: env.DATABASE_URL, max: poolMax });

if (env.NODE_ENV !== 'production') {
  globalThis.__aperturePool = pool;
}

export const db = drizzle(pool, { schema });

export type Database = typeof db;
