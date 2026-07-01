// Dev-only seed: creates a standalone "Demo Overlay" map with J160941 as the
// single system and 5 fake online characters inside it, so the SystemOverlay /
// PilotRoster can be eyeballed in the browser. Idempotent — tears everything
// down by name/ID before re-inserting.
//
// Works with or without the SDE ingested:
//   - SDE present  → uses the real J160941 universe_system row.
//   - SDE absent   → inserts placeholder region/constellation/system rows
//                    (IDs 99000001) that are removed on cleanup.
import { and, eq, inArray, like } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import {
  apCharacter,
  apMap,
  apMapCharacterTracking,
  apMapSystem,
  apUser,
  universeConstellation,
  universeRegion,
  universeSystem,
} from '@/db/schema';

const SYSTEM_NAME = process.argv[2]?.trim();
if (!SYSTEM_NAME) {
  console.error('Usage: pnpm seed:demo-presence <system-name>  (e.g. J160941)');
  process.exit(1);
}
const MAP_NAME = `Demo Overlay ${SYSTEM_NAME}`;

// Placeholder IDs used when the SDE is not ingested. Cleaned up on re-run.
const PLACEHOLDER_REGION_ID = 99_000_001;
const PLACEHOLDER_CONSTELLATION_ID = 99_000_001;
const PLACEHOLDER_SYSTEM_ID = 99_000_001;

// Fake EVE character IDs well outside the real player range (90 000 000+).
const SEED_CHAR_IDS = [
  2_000_000_001n,
  2_000_000_002n,
  2_000_000_003n,
  2_000_000_004n,
  2_000_000_005n,
];

const FAKE_CHARACTERS: { id: bigint; name: string; shipName: string; shipTypeId: number }[] = [
  { id: 2_000_000_001n, name: 'Aura Veloxi',    shipName: 'Ghost Protocol', shipTypeId: 29984 }, // Tengu
  { id: 2_000_000_002n, name: 'Kira Solstice',  shipName: 'Silent Running', shipTypeId: 35683 }, // Stratios
  { id: 2_000_000_003n, name: 'Dren Ashveil',   shipName: 'Pale Rider',     shipTypeId: 29990 }, // Loki
  { id: 2_000_000_004n, name: 'Mira Coldfront', shipName: 'Widow Maker',    shipTypeId: 28659 }, // Legion
  { id: 2_000_000_005n, name: 'Zeph Orryn',     shipName: 'Quantum Drift',  shipTypeId: 28661 }, // Proteus
];

async function main(systemName: string) {
  // ── Cleanup ────────────────────────────────────────────────────────────────

  // Delete all Demo Overlay maps regardless of system name suffix, so leftover
  // maps from previous runs don't block the placeholder universe row cleanup.
  await db.delete(apMap).where(like(apMap.name, 'Demo Overlay %'));

  // Find the ap_user rows that own the fake characters so we can cascade-delete
  // them (user → character cascade, not the reverse).
  const existingChars = await db
    .select({ userId: apCharacter.userId })
    .from(apCharacter)
    .where(inArray(apCharacter.id, SEED_CHAR_IDS));
  const orphanUserIds = existingChars.map((r) => r.userId);
  if (orphanUserIds.length > 0) {
    await db.delete(apUser).where(inArray(apUser.id, orphanUserIds));
    // ap_character + ap_map_character_tracking are cascade-deleted with the user.
  }

  // Remove placeholder universe rows if present (SDE not ingested).
  await db
    .delete(universeSystem)
    .where(
      and(
        eq(universeSystem.id, PLACEHOLDER_SYSTEM_ID),
        eq(universeSystem.name, systemName),
      ),
    );
  await db
    .delete(universeConstellation)
    .where(eq(universeConstellation.id, PLACEHOLDER_CONSTELLATION_ID));
  await db.delete(universeRegion).where(eq(universeRegion.id, PLACEHOLDER_REGION_ID));

  // ── Resolve J160941 ────────────────────────────────────────────────────────

  let systemId: number;

  const [sdeSystem] = await db
    .select({ id: universeSystem.id })
    .from(universeSystem)
    .where(eq(universeSystem.name, systemName))
    .limit(1);

  if (sdeSystem) {
    systemId = sdeSystem.id;
    console.log(`Found ${systemName} in SDE (id=${systemId}).`);
  } else {
    // SDE not ingested — insert placeholder universe rows so the FK chain holds.
    console.log(`${systemName} not in SDE — inserting placeholder universe rows.`);
    await db
      .insert(universeRegion)
      .values({ id: PLACEHOLDER_REGION_ID, name: 'Seed Placeholder Region' })
      .onConflictDoNothing();
    await db
      .insert(universeConstellation)
      .values({ id: PLACEHOLDER_CONSTELLATION_ID, regionId: PLACEHOLDER_REGION_ID, name: 'Seed Placeholder Constellation' })
      .onConflictDoNothing();
    await db
      .insert(universeSystem)
      .values({ id: PLACEHOLDER_SYSTEM_ID, constellationId: PLACEHOLDER_CONSTELLATION_ID, name: systemName, security: 'C3' })
      .onConflictDoNothing();
    systemId = PLACEHOLDER_SYSTEM_ID;
  }

  // ── Map ────────────────────────────────────────────────────────────────────

  const [map] = await db
    .insert(apMap)
    .values({ name: MAP_NAME, scope: 'all', type: 'private' })
    .returning({ id: apMap.id });

  await db.insert(apMapSystem).values({
    mapId: map!.id,
    systemId,
    visible: true,
    positionX: 300,
    positionY: 200,
    status: 'friendly',
    alias: 'Home',
    tag: 'HQ',
  });

  // ── Users + Characters ─────────────────────────────────────────────────────

  const userRows = await db
    .insert(apUser)
    .values(FAKE_CHARACTERS.map(() => ({})))
    .returning({ id: apUser.id });

  const now = new Date();
  await db.insert(apCharacter).values(
    FAKE_CHARACTERS.map((c, i) => ({
      id: c.id,
      userId: userRows[i]!.id,
      name: c.name,
      ownerHash: `seed-fake-hash-${c.id}`,
      lastSystemId: systemId,
      lastShipTypeId: c.shipTypeId,
      lastShipName: c.shipName,
      lastOnline: true,
      lastLocationAt: now,
      status: 'active' as const,
    })),
  );

  // Set each character as the main on its own account.
  for (let i = 0; i < userRows.length; i++) {
    await db
      .update(apUser)
      .set({ mainCharacterId: FAKE_CHARACTERS[i]!.id })
      .where(eq(apUser.id, userRows[i]!.id));
  }

  // ── Tracking ───────────────────────────────────────────────────────────────

  await db.insert(apMapCharacterTracking).values(
    FAKE_CHARACTERS.map((c) => ({ mapId: map!.id, characterId: c.id })),
  );

  console.log(
    `Seeded map "${MAP_NAME}" with ${systemName} (id=${systemId}) and ${FAKE_CHARACTERS.length} fake online characters.`,
  );
}

main(SYSTEM_NAME)
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await pool.end();
    process.exit(1);
  });
