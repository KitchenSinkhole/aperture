import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { IngestResult } from '@/lib/sde/ingest';

/**
 * Spawns `scripts/sde-ingest-child.ts` as an isolated child process running
 * `runIngest` — own dedicated `pg.Pool`, own event loop — so an SDE ingest
 * never starves the app's WS heartbeats or shares its pool with location-poll.
 * Shared by the `sde-ingest` (on-demand, `override`d to the build the database
 * holds) and `sde-refresh` (cron, `override`d to the newly observed build) job
 * tasks.
 */

const CHILD_POOL_MAX = 2;
const STDERR_TAIL_LINES = 20;
/**
 * Ceiling on a whole ingest — download, ~100MB YAML parse, bulk upserts,
 * deletion sync. Generous enough that a slow box finishes inside it, finite so
 * a wedged child can never hold one of the four worker slots indefinitely.
 */
const CHILD_TIMEOUT_MS = 30 * 60_000;
/** Grace between SIGTERM and SIGKILL for a child that has stopped responding. */
const CHILD_SIGKILL_GRACE_MS = 10_000;

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

    let settled = false;
    let sigkillTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      child.kill('SIGTERM');
      sigkillTimer = setTimeout(() => child.kill('SIGKILL'), CHILD_SIGKILL_GRACE_MS);
      settle(() => reject(new Error(`sde-ingest child timed out after ${CHILD_TIMEOUT_MS}ms and was killed`)));
    }, CHILD_TIMEOUT_MS);

    function settle(fn: () => void) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      fn();
    }

    child.on('error', (err) => settle(() => reject(err)));
    child.on('exit', (code, signal) => {
      if (sigkillTimer) clearTimeout(sigkillTimer);
      settle(() => {
        if (code === 0) {
          try {
            resolve(lastJsonLine(stdout));
          } catch (err) {
            reject(new Error(`sde-ingest child produced unparseable output: ${(err as Error).message}`));
          }
          return;
        }
        const tail = stderrLines.filter(Boolean).join('\n');
        const how = code == null ? `killed by ${signal}` : `exited with code ${code}`;
        reject(new Error(`sde-ingest child ${how}: ${tail}`));
      });
    });
  });
}
