import { pool } from '@/db/client';
import { runIngest } from '@/lib/sde/ingest';

function readOverride(): { build: number; releaseDate: string } | undefined {
  const build = process.env.SDE_INGEST_BUILD;
  const releaseDate = process.env.SDE_INGEST_RELEASE_DATE;
  if (!build || !releaseDate) return undefined;
  return { build: Number(build), releaseDate };
}

async function main() {
  const result = await runIngest(readOverride());
  console.log(JSON.stringify(result));
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    await pool.end();
    process.exit(1);
  });
