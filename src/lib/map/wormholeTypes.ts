import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  universeDogmaAttribute,
  universeSystem,
  universeSystemStatic,
  universeTypeAttributeEffective,
  universeWormhole,
} from '@/db/schema';
import { jumpMassBand, type WormholeCatalogEntry } from '@/lib/map/wormholeCatalog';

export type { WormholeCatalogEntry, WormholeTypeOption } from '@/lib/map/wormholeCatalog';
export { jumpMassBand } from '@/lib/map/wormholeCatalog';

/** Dogma attribute carrying a wormhole's per-jump max mass (kg). */
const JUMP_MASS_ATTR_NAME = 'wormholeMaxJumpMass';

/**
 * Wormhole-catalog lookups for two use-cases:
 *   1. class-filtered WH-type suggestion when marking a signature as a wormhole;
 *   2. "mark as static" — identifying which of a system's statics a connection is.
 *
 * Class join key: `universe_system.security` (the C1–C6 / H / L / 0.0 labels),
 * NOT `universe_system.security_class`. `universe_wormhole`'s
 * `source_classes`/`target_class` use the same labels as `universe_system.security`,
 * and the seeded catalog uses exactly those (e.g. a C3 static carries
 * `source_classes = {'C3'}`). `security_class` is the unrelated SDE ore-spawn field.
 */

export type StaticMatch = {
  typeId: number;
  name: string;
  /** The static's destination class — equals the target system's class on a match. */
  targetClass: string | null;
};

/**
 * The full, system-independent wormhole catalog ordered by code — every
 * `universe_wormhole` row with its inferred jump-mass band. Static reference
 * data, identical for every system, so it's fetched once per session and the
 * dropdown's per-system grouping (`isStatic` / `matchesClass`) is derived on the
 * client via `annotateWormholeTypes`.
 */
export async function wormholeCatalog(): Promise<WormholeCatalogEntry[]> {
  // The jump-mass band is derived from the `wormholeMaxJumpMass` dogma value,
  // read through the effective view (so any override is honoured). Resolve the
  // attribute id by name — an SDE renumber must surface as a null band, not a
  // silently wrong join.
  const [jumpMassAttr] = await db
    .select({ id: universeDogmaAttribute.id })
    .from(universeDogmaAttribute)
    .where(eq(universeDogmaAttribute.name, JUMP_MASS_ATTR_NAME));

  if (!jumpMassAttr) {
    const rows = await db
      .select({
        typeId: universeWormhole.typeId,
        name: universeWormhole.name,
        sourceClasses: universeWormhole.sourceClasses,
        targetClass: universeWormhole.targetClass,
      })
      .from(universeWormhole)
      .orderBy(universeWormhole.name);
    return rows.map((r) => ({ ...r, jumpMassClass: null }));
  }

  const rows = await db
    .select({
      typeId: universeWormhole.typeId,
      name: universeWormhole.name,
      sourceClasses: universeWormhole.sourceClasses,
      targetClass: universeWormhole.targetClass,
      jumpMass: universeTypeAttributeEffective.value,
    })
    .from(universeWormhole)
    .leftJoin(
      universeTypeAttributeEffective,
      and(
        eq(universeTypeAttributeEffective.typeId, universeWormhole.typeId),
        eq(universeTypeAttributeEffective.attrId, jumpMassAttr.id),
      ),
    )
    .orderBy(universeWormhole.name);

  return rows.map(({ jumpMass, ...r }) => ({ ...r, jumpMassClass: jumpMassBand(jumpMass) }));
}

/**
 * "Mark as static": which of the source system's statics lead into the target
 * system's class. Resolves the target system's class label, then matches it
 * against each of the source system's `universe_system_static` rows via
 * `universe_wormhole.target_class`. Returns every matching static (a system can
 * have more than one); empty when nothing matches or the target class is unknown.
 */
export async function staticMatchForConnection(args: {
  /** System the connection leaves from (the one whose statics we check). */
  sourceSystemId: number;
  /** System the connection leads into. */
  targetSystemId: number;
}): Promise<StaticMatch[]> {
  const [target] = await db
    .select({ security: universeSystem.security })
    .from(universeSystem)
    .where(eq(universeSystem.id, args.targetSystemId));
  if (!target?.security) return [];

  return db
    .select({
      typeId: universeWormhole.typeId,
      name: universeWormhole.name,
      targetClass: universeWormhole.targetClass,
    })
    .from(universeSystemStatic)
    .innerJoin(universeWormhole, eq(universeSystemStatic.typeId, universeWormhole.typeId))
    .where(
      and(
        eq(universeSystemStatic.systemId, args.sourceSystemId),
        eq(universeWormhole.targetClass, target.security),
      ),
    );
}
