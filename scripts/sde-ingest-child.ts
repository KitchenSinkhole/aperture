import { pool } from '@/db/client';
import { runIngest } from '@/lib/sde/ingest';

async function main() {
  const result = await runIngest();
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
