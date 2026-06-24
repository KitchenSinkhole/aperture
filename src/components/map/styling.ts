import type { MapConnectionEdge, MapSystemNode } from '@/lib/map/loadMap';
import type { SystemEffectKey } from '@/lib/eve/systemEffects';
import type { NoteSeverity } from '@/lib/map/enumLabels';

// The map encodes status and connection state purely as colour/stroke, with
// explicit values so the canvas is readable without Tailwind tokens leaking
// into SVG.

// Covers universe_system.security labels: H, L, 0.0, C1–C6, P (Pochven), A (Abyssal).
// C1–C6 progress from cool blue to orangy-red to signal increasing danger.
const SYSTEM_CLASS_COLORS: Partial<Record<string, string>> = {
  H: '#22c55e',    // high-sec — green
  L: '#fb923c',    // low-sec — orange
  '0.0': '#dc2626', // null-sec — firetruck red
  P: '#9f1239',    // Pochven — deep red with purple
  A: '#2dd4bf',    // Abyssal — teal
  C1: '#38c2f8',
  C2: '#0698ec',
  C3: '#9ab910',
  C4: '#eab308',
  C5: '#f97316',
  C6: '#ea580c',   // orangy-red
};

/** Colour for a `universe_system.security` or `universe_wormhole.target_class` label. */
export function systemClassColor(cls: string | null | undefined): string {
  if (!cls) return '#6b7280';
  return SYSTEM_CLASS_COLORS[cls] ?? '#6b7280';
}

// EVE's standard true-security gradient, keyed by one-decimal band: 1.0 cyan →
// 0.5 yellow → 0.1 red. Anything ≤ 0.0 (null-sec) reads as solid red.
const TRUE_SEC_COLORS: Record<string, string> = {
  '1.0': '#2fefef',
  '0.9': '#48f0c0',
  '0.8': '#00ef47',
  '0.7': '#00f000',
  '0.6': '#8fef2f',
  '0.5': '#efef00',
  '0.4': '#d77700',
  '0.3': '#f06000',
  '0.2': '#f04800',
  '0.1': '#d73000',
};

/** Colour for a k-space true-security value (`universe_system.true_sec`). */
export function trueSecColor(sec: number): string {
  if (sec <= 0) return '#f00000';
  return TRUE_SEC_COLORS[(Math.round(sec * 10) / 10).toFixed(1)] ?? '#f00000';
}

const STATUS_COLORS: Record<MapSystemNode['status'], string> = {
  unknown: '#6b7280',
  friendly: '#3b82f6',
  occupied: '#f59e0b',
  hostile: '#ef4444',
  empty: '#22c55e',
  unscanned: '#a855f7',
};

export function systemStatusColor(status: MapSystemNode['status']): string {
  return STATUS_COLORS[status];
}

// Reserved for the Home-system marker (accent ring + header icon). Kept distinct
// from the status palette so it never reads as a system status.
const HOME_ACCENT = '#fbbf24'; // amber/gold

/** Accent colour for the designated Home system's ring and header icon. */
export function homeAccentColor(): string {
  return HOME_ACCENT;
}

// Map-note severity → border colour. `neutral` matches the file's default grey
// (so an unflagged note reads as "no severity"); green/yellow/red escalate using
// the same hues as the status palette.
const NOTE_SEVERITY_COLORS: Record<NoteSeverity, string> = {
  neutral: '#6b7280',
  green: '#22c55e',
  yellow: '#eab308',
  red: '#ef4444',
};

/** Border colour for a map note, by severity. */
export function noteSeverityColor(severity: NoteSeverity): string {
  return NOTE_SEVERITY_COLORS[severity];
}

// W-space anomaly-effect swatch colours for the node indicator.
const SYSTEM_EFFECT_COLORS: Record<SystemEffectKey, string> = {
  magnetar: '#e06fdf',    // pink
  redGiant: '#d9534f',    // red
  pulsar: '#428bca',      // blue
  wolfRayet: '#e28a0d',   // orange
  cataclysmic: '#ffffbb', // yellow (lighter)
  blackHole: '#000000',   // black
};

/** Swatch colour for a W-space system effect. */
export function systemEffectColor(key: SystemEffectKey): string {
  return SYSTEM_EFFECT_COLORS[key];
}

const MASS_COLORS: Record<MapConnectionEdge['massStatus'], string> = {
  fresh: '#84cc16',
  reduced: '#f59e0b',
  critical: '#ef4444',
};

const SCOPE_COLORS: Record<MapConnectionEdge['scope'], string> = {
  wh: '#cbd5e1',
  stargate: '#4ade80',
  jumpbridge: '#a855f7',
  abyssal: '#f97316',
};

export type EdgeStyle = {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
};

/**
 * Stroke styling for a connection. Scope picks the base colour; wormholes are
 * recoloured by mass status. EOL connections dash — the `critical` (1h) stage
 * dashes more tightly than the `eol` (4h) stage to read as more urgent; frigate
 * holes thin out.
 */
export function connectionStyle(edge: MapConnectionEdge): EdgeStyle {
  const stroke = edge.scope === 'wh' ? MASS_COLORS[edge.massStatus] : SCOPE_COLORS[edge.scope];
  return {
    stroke,
    strokeWidth: edge.jumpMassClass === 's' ? 1.5 : 3,
    strokeDasharray:
      edge.eolStage === 'critical' ? '2 3' : edge.eolStage === 'eol' ? '6 4' : undefined,
  };
}

export type ConnectionBadge = {
  key: string;
  label: string;
  /**
   * Small/frigate holes are easy to miss and people bring oversized ships, so
   * the `s` size badge renders as a filled warning pill rather than plain text.
   */
  warn?: boolean;
};

/**
 * Text badges stacked on a connection: STATIC, jump-mass size, EOL. Rolling and
 * preserve-mass are surfaced as standalone icons by `ConnectionEdge`, not here,
 * because they carry enough operational weight to warrant a glyph over text.
 */
export function connectionBadges(edge: MapConnectionEdge): ConnectionBadge[] {
  const badges: ConnectionBadge[] = [];
  if (edge.isStatic) badges.push({ key: 'static', label: 'STATIC' });
  if (edge.jumpMassClass) {
    badges.push({
      key: 'size',
      label: edge.jumpMassClass.toUpperCase(),
      warn: edge.jumpMassClass === 's',
    });
  }
  if (edge.eolStage === 'critical') badges.push({ key: 'eol', label: 'EOL 1h' });
  else if (edge.eolStage === 'eol') badges.push({ key: 'eol', label: 'EOL' });
  return badges;
}
