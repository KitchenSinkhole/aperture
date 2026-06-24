import type { WhJumpMass } from '@/lib/map/enumLabels';

/**
 * Client-safe wormhole-catalog shapes + annotation. No `import 'server-only'`:
 * the catalog is static reference data fetched once per session, and the
 * dropdown computes its per-system grouping (`isStatic` / `matchesClass`)
 * locally rather than re-fetching the whole catalog per system. The DB read
 * that produces a `WormholeCatalogEntry[]` lives server-side in
 * `wormholeTypes.ts`.
 */

/**
 * One row of the immutable wormhole catalog — identical for every system. Class
 * filtering is derived from these fields on the client, not baked into the row.
 */
export type WormholeCatalogEntry = {
  typeId: number;
  /** WH code, e.g. `A239`, `K162`. */
  name: string;
  /** Classes it can spawn in; null = source unspecified (K162 + Drifter/shattered-access holes). */
  sourceClasses: string[] | null;
  /** Class it leads into; null = resolved from the far side. */
  targetClass: string | null;
  /** Inferred per-jump size band from `wormholeMaxJumpMass`; null = unknown (e.g. K162). */
  jumpMassClass: WhJumpMass | null;
};

/**
 * A catalog entry annotated for one host system's WH-type dropdown: tagged with
 * whether it is one of the system's statics and whether it plausibly spawns here.
 */
export type WormholeTypeOption = WormholeCatalogEntry & {
  /** True when this type is one of the host system's statics (anoik.is). */
  isStatic: boolean;
  /**
   * True when this hole plausibly spawns in the host system: its source set is
   * null (appears anywhere), contains the system's class, or it is one of the
   * system's statics. Drives the dropdown's default vs. "show all" split.
   */
  matchesClass: boolean;
};

/**
 * Annotate the static catalog for one host system — the client-side equivalent
 * of what the server used to compute per request. `system.security` is the class
 * label (C1–C6 / H / L / 0.0 / …, the same labels `sourceClasses` uses);
 * `staticTypeIds` is the system's static `universe_wormhole.type_id` set. The
 * static clause keeps a shattered system's odd-class statics visible by default.
 */
export function annotateWormholeTypes(
  catalog: WormholeCatalogEntry[],
  system: { security: string | null; staticTypeIds: number[] },
): WormholeTypeOption[] {
  const staticTypeIds = new Set(system.staticTypeIds);
  return catalog.map((entry) => {
    const isStatic = staticTypeIds.has(entry.typeId);
    const matchesClass =
      entry.sourceClasses == null ||
      (system.security != null && entry.sourceClasses.includes(system.security)) ||
      isStatic;
    return { ...entry, isStatic, matchesClass };
  });
}
