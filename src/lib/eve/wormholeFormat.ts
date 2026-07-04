/**
 * Display formatters for wormhole mass / lifetime reference values. Shared by
 * the Jump Info dialog, the connection mass-log, and the connection detail
 * popover so the community units render identically everywhere.
 */

/** Wormhole masses are kilograms; the community unit is kilotonnes (1 kt = 1e6 kg). */
export function formatWormholeMass(kg: number | null): string {
  if (kg == null) return '—';
  return `${new Intl.NumberFormat('en-US').format(Math.round(kg / 1e6))} kt`;
}

/** Wormhole lifetimes are stored in minutes; rendered as whole hours. */
export function formatWormholeLifetime(minutes: number | null): string {
  if (minutes == null) return '—';
  return `${Math.round(minutes / 60)}h`;
}
