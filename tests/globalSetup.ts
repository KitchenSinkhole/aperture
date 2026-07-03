import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// Apply all pending migrations once, before vitest spawns its parallel workers.
// The DB-backed suites each call migrate() in beforeAll; with nothing pending
// those calls run no DDL. That removes the concurrent first-run race where two
// workers migrate a fresh DB at once and collide on pg_type (a duplicate-key on
// the first CREATE TABLE).
export default async function setup() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;

  const pool = new Pool({ connectionString });
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'src/db/migrations' });
  } finally {
    await pool.end();
  }
}
