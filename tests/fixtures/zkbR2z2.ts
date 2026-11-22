/**
 * One entry of zKillboard's R2Z2 ephemeral feed: the ESI killmail nested under
 * `esi`, with the hash at the top level and the `zkb` block alongside. The
 * solar system is not at the top level.
 */
export function r2z2Kill(
  overrides: {
    killmailId?: number;
    systemId?: number;
    killmailTime?: string;
    shipTypeId?: number;
    hash?: string;
    totalValue?: number;
  } = {},
) {
  const killmailId = overrides.killmailId ?? 555;
  return {
    killmail_id: killmailId,
    hash: overrides.hash ?? 'abc',
    esi: {
      killmail_id: killmailId,
      killmail_time: overrides.killmailTime ?? new Date().toISOString(),
      solar_system_id: overrides.systemId ?? 30000142,
      victim: { ship_type_id: overrides.shipTypeId ?? 587, character_id: 90000001, corporation_id: 98000001 },
      attackers: [{}, {}],
    },
    zkb: { totalValue: overrides.totalValue ?? 8_000_000 },
  };
}
