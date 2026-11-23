/**
 * Idempotent dev seed: "BUILD2 Perf Chain" with 120 visible systems in a grid.
 * Requires SDE ingest (`pnpm sde:bootstrap`).
 */
import { eq, like } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { apMap, apMapConnection, apMapSystem, universeSystem } from '@/db/schema';

const MAP_NAME = 'BUILD2 Perf Chain';
const TARGET = 120;

async function main() {
  const t0 = performance.now();
  const wormholes = await db
    .select({ id: universeSystem.id })
    .from(universeSystem)
    .where(like(universeSystem.security, 'C_'))
    .limit(TARGET);

  if (wormholes.length < TARGET) {
    throw new Error(`Need ${TARGET} wormhole systems; found ${wormholes.length}. Run SDE ingest.`);
  }

  await db.delete(apMap).where(eq(apMap.name, MAP_NAME));

  const [map] = await db
    .insert(apMap)
    .values({ name: MAP_NAME, scope: 'all', type: 'private' })
    .returning({ id: apMap.id });

  const cols = 12;
  const systemRows = await db
    .insert(apMapSystem)
    .values(
      wormholes.map((w, i) => ({
        mapId: map!.id,
        systemId: w.id,
        visible: true,
        positionX: (i % cols) * 140,
        positionY: Math.floor(i / cols) * 100,
        status: 'unknown' as const,
        tag: i === 0 ? 'HQ' : String(i),
        alias: i === 0 ? 'Home' : null,
      })),
    )
    .returning({ id: apMapSystem.id, systemId: apMapSystem.systemId });

  const byIdx = systemRows.map((r) => r.id);
  const conns = [];
  for (let i = 0; i < byIdx.length - 1; i++) {
    conns.push({
      mapId: map!.id,
      sourceMapSystemId: byIdx[i]!,
      targetMapSystemId: byIdx[i + 1]!,
      scope: 'wh' as const,
      massStatus: 'fresh' as const,
      eolStage: 'none' as const,
    });
  }
  if (conns.length) await db.insert(apMapConnection).values(conns);

  const ms = Math.round(performance.now() - t0);
  console.log(JSON.stringify({ mapId: map!.id.toString(), systems: systemRows.length, seedMs: ms }));
}

void main().finally(() => pool.end());
