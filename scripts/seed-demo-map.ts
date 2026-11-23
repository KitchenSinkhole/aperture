// Dev-only seed: inserts one demo map ("Demo Chain") with a handful of systems
// and connections so the map view can be eyeballed in the browser. Idempotent —
// deletes the map by name first. Requires the SDE to have been ingested
// (`pnpm sde:bootstrap`).
import { eq, inArray, like } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { apMap, apMapConnection, apMapSystem, universeSystem } from '@/db/schema';

const MAP_NAME = 'Demo Chain';
const JITA = 30000142;
const PERIMETER = 30000144; // Jita gate neighbour, for a stargate connection.

async function main() {
  // Pick whatever real systems exist: Jita + its neighbour (k-space) and a few
  // wormhole systems (security class C1–C6).
  const kspace = await db
    .select({ id: universeSystem.id, name: universeSystem.name })
    .from(universeSystem)
    .where(inArray(universeSystem.id, [JITA, PERIMETER]));
  const wormholes = await db
    .select({ id: universeSystem.id, name: universeSystem.name })
    .from(universeSystem)
    .where(like(universeSystem.security, 'C_'))
    .limit(4);

  if (wormholes.length < 3) {
    throw new Error('Not enough wormhole systems found — has the SDE been ingested?');
  }

  // Reset.
  await db.delete(apMap).where(eq(apMap.name, MAP_NAME));

  const [map] = await db
    .insert(apMap)
    .values({ name: MAP_NAME, scope: 'all', type: 'private' })
    .returning({ id: apMap.id });

  // Lay out: a wormhole chain on the left, Jita/Perimeter (k-space) on the right.
  const layout: {
    systemId: number;
    x: number;
    y: number;
    status: 'unknown' | 'friendly' | 'occupied' | 'hostile' | 'empty';
    alias?: string;
    tag?: string;
  }[] = [
    { systemId: wormholes[0]!.id, x: 80, y: 200, status: 'friendly', alias: 'Home', tag: 'HQ' },
    { systemId: wormholes[1]!.id, x: 320, y: 100, status: 'occupied', tag: 'A' },
    { systemId: wormholes[2]!.id, x: 320, y: 320, status: 'hostile', tag: 'B' },
  ];
  if (wormholes[3]) {
    layout.push({ systemId: wormholes[3].id, x: 560, y: 320, status: 'empty', tag: 'C' });
  }
  const jita = kspace.find((s) => s.id === JITA);
  const perimeter = kspace.find((s) => s.id === PERIMETER);
  if (jita) layout.push({ systemId: jita.id, x: 560, y: 100, status: 'unknown' });
  if (perimeter) layout.push({ systemId: perimeter.id, x: 800, y: 100, status: 'unknown' });

  const systemRows = await db
    .insert(apMapSystem)
    .values(
      layout.map((l) => ({
        mapId: map!.id,
        systemId: l.systemId,
        visible: true,
        positionX: l.x,
        positionY: l.y,
        status: l.status,
        alias: l.alias ?? null,
        tag: l.tag ?? null,
      })),
    )
    .returning({ id: apMapSystem.id, systemId: apMapSystem.systemId });

  const byEve = new Map(systemRows.map((r) => [r.systemId, r.id]));
  const conn = (
    fromEve: number,
    toEve: number,
    extra: Partial<typeof apMapConnection.$inferInsert>,
  ): typeof apMapConnection.$inferInsert | null => {
    const source = byEve.get(fromEve);
    const target = byEve.get(toEve);
    if (source == null || target == null) return null;
    return { mapId: map!.id, sourceMapSystemId: source, targetMapSystemId: target, scope: 'wh', ...extra };
  };

  const connections = [
    conn(wormholes[0]!.id, wormholes[1]!.id, { massStatus: 'fresh' }),
    conn(wormholes[0]!.id, wormholes[2]!.id, { massStatus: 'reduced', eolStage: 'eol', eolSource: 'observed' }),
    wormholes[3]
      ? conn(wormholes[2]!.id, wormholes[3].id, {
          massStatus: 'critical',
          jumpMassClass: 's',
        })
      : null,
    jita ? conn(wormholes[2]!.id, jita.id, { massStatus: 'fresh', jumpMassClass: 'l' }) : null,
    jita && perimeter ? conn(jita.id, perimeter.id, { scope: 'stargate' }) : null,
  ].filter((c): c is typeof apMapConnection.$inferInsert => c !== null);

  await db.insert(apMapConnection).values(connections);

  console.log(
    `Seeded "${MAP_NAME}" (map ${map!.id}) with ${systemRows.length} systems and ${connections.length} connections.`,
  );
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await pool.end();
    process.exit(1);
  });
