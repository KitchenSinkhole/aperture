// Shattered wormhole systems have had their planets and moons blasted apart —
// no anchorable celestials, a permanent system effect, and (for the class-13
// frigate holes) hard ship-size limits.
//
// Every shattered J-space system is identifiable straight from its J-sig: CCP
// numbered them in the J0xxxxx band (J000102 – J015227), so a leading "J0" is
// both necessary and sufficient. Regular wormholes are named J1xxxxx and up;
// the five Drifter systems carry lore names ("Liberated Barbican", …) and so
// never match. Thera is the one shattered system without a J-sig and is matched
// by name.

const SHATTERED_JSIG = /^J0\d{5}$/;

/**
 * True if the system name is a shattered wormhole system: Thera plus the
 * J0xxxxx J-sig band. Drifter systems carry lore names and are excluded.
 */
export function isShatteredSystem(name: string): boolean {
  return name === 'Thera' || SHATTERED_JSIG.test(name);
}
