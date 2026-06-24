import type { SystemNotificationLoad } from '@/lib/realtime/protocol';
import type { UnderglowConfig } from '@/types';

/**
 * Client-side visual presets per `systemNotification` kind. The server sends a
 * lean `kind` over the wire; the client owns the look here so the transport
 * stays decoupled from styling.
 */
export const UNDERGLOW_PRESETS: Record<SystemNotificationLoad['kind'], UnderglowConfig> = {
  // Killmail: red, ~15s transient pulse.
  killmail: { color: '#ef4444', brightness: 0.9, durationMs: 15_000, speedMs: 1_400 },
  // Ping: a short, fast sky-blue pulse — a user draws attention to a system
  // without the commitment of a rally point. Distinct hue and a brisker cycle
  // than the killmail alert so the two read differently.
  ping: { color: '#38bdf8', brightness: 0.95, durationMs: 10_000, speedMs: 1_000 },
};

/**
 * State-derived glow for a designated rally point (`ap_map_system.rally_at`).
 * Unlike the `systemNotification` kinds above this is not transient: it is
 * rendered directly from the node's `rallyAt` for as long as the rally is set,
 * so it bypasses the transient underglow store entirely (a coinciding killmail
 * flash can't overwrite or clear it). `durationMs: 0` marks it persistent; a
 * warm amber hue distinct from killmail red / ping blue, and a slow pulse cycle
 * that reads as a steady "muster here" rather than an alert flash.
 */
export const RALLY_UNDERGLOW: UnderglowConfig = {
  color: '#9036e4',
  brightness: 0.85,
  durationMs: 0,
  speedMs: 2_600,
};
