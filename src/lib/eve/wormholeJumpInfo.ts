import 'server-only';
import { and, inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  universeDogmaAttribute,
  universeTypeAttributeEffective,
  universeWormhole,
} from '@/db/schema';

/**
 * Wormhole jump reference data for the Jump Info dialog, sourced from
 * static data.
 *
 * The routing catalog (code + source/target class) lives in `universe_wormhole`;
 * mass / lifetime / sig-strength are dogma attributes read from the
 * `universe_type_attribute_effective` view so the attr-3974 sig-strength override
 * is honoured. Attribute ids are resolved by name (not hard-coded) so an SDE
 * re-number can't silently zero a column.
 */

const ATTR_NAMES = {
  totalMass: 'wormholeMaxStableMass',
  jumpMass: 'wormholeMaxJumpMass',
  lifetimeMinutes: 'wormholeMaxStableTime',
  sigStrength: 'scanWormholeStrength',
} as const;

export type WormholeJumpInfoRow = {
  /** `universe_wormhole.type_id`. */
  typeId: number;
  /** WH code, e.g. `A239`, `K162`. */
  code: string;
  /** Classes it spawns in; null = source unspecified (K162 + Drifter/shattered-access holes). */
  sourceClasses: string[] | null;
  /** Class it leads into; null = resolved from the far side. */
  targetClass: string | null;
  /** Total stable mass (kg). */
  totalMass: number | null;
  /** Max mass per single jump (kg). */
  jumpMass: number | null;
  /** Maximum stable lifetime (minutes). */
  lifetimeMinutes: number | null;
  /** Cosmic-signature scan strength (0–1). */
  sigStrength: number | null;
};

/**
 * Every wormhole in the catalog with its mass / lifetime / sig-strength, ordered
 * by code. Columns with no dogma value resolve to `null`.
 */
export async function wormholeJumpInfo(): Promise<WormholeJumpInfoRow[]> {
  const attrDefs = await db
    .select({ id: universeDogmaAttribute.id, name: universeDogmaAttribute.name })
    .from(universeDogmaAttribute)
    .where(inArray(universeDogmaAttribute.name, Object.values(ATTR_NAMES)));

  const attrIdByName = new Map(attrDefs.map((a) => [a.name, a.id]));
  const idFor = (name: string) => attrIdByName.get(name) ?? null;
  const totalMassId = idFor(ATTR_NAMES.totalMass);
  const jumpMassId = idFor(ATTR_NAMES.jumpMass);
  const lifetimeId = idFor(ATTR_NAMES.lifetimeMinutes);
  const sigStrengthId = idFor(ATTR_NAMES.sigStrength);

  const whRows = await db
    .select({
      typeId: universeWormhole.typeId,
      code: universeWormhole.name,
      sourceClasses: universeWormhole.sourceClasses,
      targetClass: universeWormhole.targetClass,
    })
    .from(universeWormhole)
    .orderBy(universeWormhole.name);

  const attrIds = [totalMassId, jumpMassId, lifetimeId, sigStrengthId].filter(
    (id): id is number => id !== null,
  );
  const typeIds = whRows.map((r) => r.typeId);

  const values =
    attrIds.length > 0 && typeIds.length > 0
      ? await db
          .select({
            typeId: universeTypeAttributeEffective.typeId,
            attrId: universeTypeAttributeEffective.attrId,
            value: universeTypeAttributeEffective.value,
          })
          .from(universeTypeAttributeEffective)
          .where(
            and(
              inArray(universeTypeAttributeEffective.typeId, typeIds),
              inArray(universeTypeAttributeEffective.attrId, attrIds),
            ),
          )
      : [];

  // typeId -> attrId -> value
  const byType = new Map<number, Map<number, number | null>>();
  for (const v of values) {
    let inner = byType.get(v.typeId);
    if (!inner) {
      inner = new Map();
      byType.set(v.typeId, inner);
    }
    inner.set(v.attrId, v.value);
  }

  const valueOf = (typeId: number, attrId: number | null): number | null =>
    attrId === null ? null : (byType.get(typeId)?.get(attrId) ?? null);

  return whRows.map((r) => ({
    typeId: r.typeId,
    code: r.code,
    sourceClasses: r.sourceClasses,
    targetClass: r.targetClass,
    totalMass: valueOf(r.typeId, totalMassId),
    jumpMass: valueOf(r.typeId, jumpMassId),
    lifetimeMinutes: valueOf(r.typeId, lifetimeId),
    sigStrength: valueOf(r.typeId, sigStrengthId),
  }));
}
