import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { IngestResult } from '@/lib/sde/ingest';

/**
 * Spawns `scripts/sde-ingest-child.ts` as an isolated child process running
 * `runIngest` — own dedicated `pg.Pool`, own event loop — so an SDE ingest
 * never starves the app's WS heartbeats or shares its pool with location-poll.
 * Shared by the `sde-ingest` (on-demand, pinned build) and `sde-refresh`
 * (cron, `override`d to the newly observed build) job tasks.
 */

const CHILD_POOL_MAX = 2;
const STDERR_TAIL_LINES = 20;

export interface SdeIngestOverride {
  build: number;
  releaseDate: string;
}

function lastJsonLine(stdout: string): IngestResult {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) throw new Error('sde-ingest child produced no output');
  return JSON.parse(last) as IngestResult;
}

export function runSdeIngestChild(override?: SdeIngestOverride): Promise<IngestResult> {
  return new Promise((resolve, reject) => {
    // Spawn tsx's own CLI entry directly under the current `node` binary rather
    // than the `.bin/tsx` shim: no shell involved, so no OS-specific executable
    // resolution (`.CMD` vs shebang) and no unescaped-argument risk.
    const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const scriptPath = join(process.cwd(), 'scripts', 'sde-ingest-child.ts');
    const env: NodeJS.ProcessEnv = { ...process.env, DB_POOL_MAX: String(CHILD_POOL_MAX) };
    if (override) {
      env.SDE_INGEST_BUILD = String(override.build);
      env.SDE_INGEST_RELEASE_DATE = override.releaseDate;
    }
    const child = spawn(process.execPath, [tsxCli, scriptPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderrLines: string[] = [];
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderrLines = [...stderrLines, ...d.toString().split('\n')].slice(-STDERR_TAIL_LINES);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        try {
          resolve(lastJsonLine(stdout));
        } catch (err) {
          reject(new Error(`sde-ingest child produced unparseable output: ${(err as Error).message}`));
        }
        return;
      }
      const tail = stderrLines.filter(Boolean).join('\n');
      reject(new Error(`sde-ingest child exited with code ${code}: ${tail}`));
    });
  });
}
