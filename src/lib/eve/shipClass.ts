import type { ShipClass } from '@/types';

/**
 * Ship-class resolution for the pilot-presence icon. EVE's SDE hierarchy is
 * exactly `universe_category` → `universe_group` → `universe_type` — most
 * hulls classify cleanly from their `universe_group.id` alone (`SHIP_GROUP_CLASS`),
 * since CCP groups by hull size/role (Frigate, Cruiser, Dreadnought, ...) and a
 * new hull release lands in an existing group with no code change required here.
 *
 * A handful of hulls share a group with a differently-classed sibling despite a
 * distinct in-game role label (Venture sits in the plain "Frigate" group, not a
 * mining-specific one; Outrider sits in "Command Destroyer" alongside five
 * combat hulls, despite its in-game "Mining Command Destroyer" label) — those
 * are keyed individually in `SHIP_TYPE_CLASS_OVERRIDES`, checked first.
 */
export const SHIP_TYPE_CLASS_OVERRIDES: Readonly<Record<number, ShipClass>> = {
  32880: 'mining-frigate', // Venture
  89648: 'mining-frigate', // Venture Consortium Issue
  89649: 'mining-destroyer', // Outrider
  89240: 'mining-destroyer', // Pioneer
  91174: 'mining-destroyer', // Perseverance
  89647: 'mining-destroyer', // Pioneer Consortium Issue
};

/** Keyed by `universe_group.id`. Ship-category groups as of SDE build 3351823. */
export const SHIP_GROUP_CLASS: Readonly<Record<number, ShipClass>> = {
  324: 'frigate', // Assault Frigate
  1201: 'battlecruiser', // Attack Battlecruiser
  27: 'battleship', // Battleship
  898: 'battleship', // Black Ops
  1202: 'industrial', // Blockade Runner
  883: 'industrial-capital', // Capital Industrial Ship
  29: 'capsule', // Capsule
  547: 'carrier', // Carrier
  419: 'battlecruiser', // Combat Battlecruiser
  906: 'cruiser', // Combat Recon Ship
  1534: 'destroyer', // Command Destroyer (Outrider overridden above)
  540: 'battlecruiser', // Command Ship
  237: 'corvette', // Corvette
  830: 'frigate', // Covert Ops
  26: 'cruiser', // Cruiser
  380: 'industrial', // Deep Space Transport
  420: 'destroyer', // Destroyer (Pioneer, Perseverance, Pioneer Consortium Issue overridden above)
  485: 'dreadnought', // Dreadnought
  893: 'frigate', // Electronic Attack Ship
  543: 'mining-barge', // Exhumer
  4902: 'battlecruiser', // Expedition Command Ship
  1283: 'mining-frigate', // Expedition Frigate
  1972: 'cruiser', // Flag Cruiser
  1538: 'carrier', // Force Auxiliary
  833: 'cruiser', // Force Recon Ship
  513: 'industrial-capital', // Freighter
  25: 'frigate', // Frigate (Venture overridden above)
  28: 'industrial', // Hauler
  358: 'cruiser', // Heavy Assault Cruiser
  894: 'cruiser', // Heavy Interdiction Cruiser
  941: 'industrial-command', // Industrial Command Ship
  831: 'frigate', // Interceptor
  541: 'destroyer', // Interdictor
  902: 'industrial-capital', // Jump Freighter
  4594: 'dreadnought', // Lancer Dreadnought
  832: 'cruiser', // Logistics
  1527: 'frigate', // Logistics Frigate
  900: 'battleship', // Marauder
  463: 'mining-barge', // Mining Barge
  1022: 'frigate', // Prototype Exploration Ship
  31: 'shuttle', // Shuttle
  5087: 'cruiser', // Special Edition Yachts
  834: 'frigate', // Stealth Bomber
  963: 'cruiser', // Strategic Cruiser
  659: 'supercarrier', // Supercarrier
  1305: 'destroyer', // Tactical Destroyer
  30: 'titan', // Titan
};

export const SHIP_CLASS_LABELS: Readonly<Record<ShipClass, string>> = {
  capsule: 'Capsule',
  shuttle: 'Shuttle',
  corvette: 'Corvette',
  frigate: 'Frigate',
  destroyer: 'Destroyer',
  cruiser: 'Cruiser',
  battlecruiser: 'Battlecruiser',
  battleship: 'Battleship',
  dreadnought: 'Dreadnought',
  carrier: 'Carrier',
  supercarrier: 'Supercarrier',
  titan: 'Titan',
  'mining-frigate': 'Mining Frigate',
  'mining-destroyer': 'Mining Destroyer',
  'mining-barge': 'Mining Barge',
  industrial: 'Industrial',
  'industrial-command': 'Industrial Command Ship',
  'industrial-capital': 'Industrial Capital Ship',
};

/**
 * Resolves a ship type to its broad class. Checks the type-level override
 * first, then falls back to the type's group. Null when either id is null
 * or unrecognized (unpublished type, a vanity hull with no bucket, or a type
 * that predates the last SDE ingest).
 */
export function resolveShipClass(
  typeId: number | null,
  groupId: number | null,
): ShipClass | null {
  if (typeId === null || groupId === null) return null;
  return SHIP_TYPE_CLASS_OVERRIDES[typeId] ?? SHIP_GROUP_CLASS[groupId] ?? null;
}
