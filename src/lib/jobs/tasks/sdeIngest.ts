import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { withInstrumentation } from '../withInstrumentation';
import type { JobModule } from '../registry';
import type { IngestResult } from '@/lib/sde/ingest';

/**
 * graphile-worker wrapper around `runIngest` so the setup wizard can trigger an
 * on-demand SDE refresh without shelling into the container.
 *
 * Spawns `scripts/sde-ingest-child.ts` as a child process (own `pg.Pool`,
 * `tsx` via the project's own dependency) rather than running `runIngest`
 * in-process: the ingest parses ~100MB of YAML and pushes bulk upserts, which
 * on the shared event loop/pool starves WS heartbeats and location-poll.
 */

const NAME = 'sde-ingest';
const CHILD_POOL_MAX = 2;
const STDERR_TAIL_LINES = 20;

function lastJsonLine(stdout: string): IngestResult {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last) throw new Error('sde-ingest child produced no output');
  return JSON.parse(last) as IngestResult;
}

function runChild(): Promise<IngestResult> {
  return new Promise((resolve, reject) => {
    // Spawn tsx's own CLI entry directly under the current `node` binary rather
    // than the `.bin/tsx` shim: no shell involved, so no OS-specific executable
    // resolution (`.CMD` vs shebang) and no unescaped-argument risk.
    const tsxCli = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const scriptPath = join(process.cwd(), 'scripts', 'sde-ingest-child.ts');
    const child = spawn(process.execPath, [tsxCli, scriptPath], {
      env: { ...process.env, DB_POOL_MAX: String(CHILD_POOL_MAX) },
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
          reject(
            new Error(`sde-ingest child produced unparseable output: ${(err as Error).message}`),
          );
        }
        return;
      }
      const tail = stderrLines.filter(Boolean).join('\n');
      reject(new Error(`sde-ingest child exited with code ${code}: ${tail}`));
    });
  });
}

async function ingest() {
  return await runChild();
}

export const sdeIngest: JobModule = {
  name: NAME,
  run: withInstrumentation(NAME, ingest),
};
