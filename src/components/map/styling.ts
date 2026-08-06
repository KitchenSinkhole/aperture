import type { MapConnectionEdge, MapSystemNode } from '@/lib/map/loadMap';
import type { SystemEffectKey } from '@/lib/eve/systemEffects';
import type { NoteSeverity } from '@/lib/map/enumLabels';
import { roundSecurity } from '@/lib/sde/security';

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

// CCP's canonical security-status gradient, keyed by the displayed value (true
// sec passed through `roundSecurity`): 1.0 blue → 0.5 yellow → 0.1 red. Anything
// that rounds to ≤ 0.0 (null-sec) reads as the deep magenta terminal colour.
// https://developers.eveonline.com/docs/guides/system-security/
const TRUE_SEC_COLORS: Record<string, string> = {
  '1.0': '#2C75E1',
  '0.9': '#399AEB',
  '0.8': '#4ECEF8',
  '0.7': '#60DBA3',
  '0.6': '#71E754',
  '0.5': '#F5FF83',
  '0.4': '#DC6C06',
  '0.3': '#CE440F',
  '0.2': '#BB1116',
  '0.1': '#731F1F',
};
const NULL_SEC_COLOR = '#8D3163';

/** Colour for a k-space true-security value (`universe_system.true_sec`). */
export function trueSecColor(sec: number): string {
  const rounded = roundSecurity(sec);
  if (rounded <= 0) return NULL_SEC_COLOR;
  return TRUE_SEC_COLORS[rounded.toFixed(1)] ?? NULL_SEC_COLOR;
}

/**
 * Colour for a system given its class label and raw security status. K-space
 * (hi/lo/null) uses the fine-grained security gradient; wormhole classes,
 * Pochven and Abyssal keep their class colour.
 */
export function systemSecurityColor(
  label: string | null | undefined,
  securityStatus: number | null | undefined,
): string {
  if (securityStatus != null && (label === 'H' || label === 'L' || label === '0.0')) {
    return trueSecColor(securityStatus);
  }
  return systemClassColor(label);
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

// Warp-bubble marker at a connection mouth. A cold, bright ice blue: held apart
// from the mass/scope palette so a bubble never reads as connection state, and
// high enough in luminance to carry against the near-black canvas at the low
// alphas the ring fill and wash use.
const BUBBLE_COLOR = '#9ec9f0';

/** Fill/stroke hue for the bubbled-end marker and its wash. */
export function connectionBubbleColor(): string {
  return BUBBLE_COLOR;
}

// The hover-revealed handle at a connection mouth. Neutral by design — it marks
// where a control is, not what state the end is in, so it must not be confused
// with the bubble marker sharing that spot.
const ENDPOINT_COLOR = '#94a3b8';

/** Fill hue for the hover-revealed endpoint handle. */
export function connectionEndpointColor(): string {
  return ENDPOINT_COLOR;
}

export type EdgeStyle = {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
};

/**
 * Stroke styling for a connection. Scope picks the base colour; wormholes are
 * recoloured by mass status. EOL connections dash — the `critical` (1h) stage
 * dashes more tightly than the `eol` (4h) stage to read as more urgent, and the
 * manual `expired` stage dashes sparsest of all to read as barely-there; frigate
 * holes thin out.
 */
export function connectionStyle(
  edge: Pick<MapConnectionEdge, 'scope' | 'massStatus' | 'jumpMassClass' | 'eolStage'>,
): EdgeStyle {
  const stroke = edge.scope === 'wh' ? MASS_COLORS[edge.massStatus] : SCOPE_COLORS[edge.scope];
  return {
    stroke,
    strokeWidth: edge.jumpMassClass === 's' ? 1.5 : 3,
    strokeDasharray:
      edge.eolStage === 'expired'
        ? '1 4'
        : edge.eolStage === 'critical'
          ? '2 3'
          : edge.eolStage === 'eol'
            ? '6 4'
            : undefined,
  };
}

export type ConnectionBadge = {
  key: string;
  label: string;
  /**
   * Renders the badge as a filled pill rather than plain text, for "check before
   * you jump" hazards: `warn` (amber) for the `s` (frigate) size badge — easy to
   * miss, people bring oversized ships — and `danger` (red) for the `EXPIRED`
   * marker (do not jump).
   */
  tone?: 'warn' | 'danger';
};

/**
 * Text badges stacked on a connection: STATIC, jump-mass size, EOL. Rolling and
 * preserve-mass are surfaced as standalone icons by `ConnectionEdge`, not here,
 * because they carry enough operational weight to warrant a glyph over text.
 */
export function connectionBadges(
  edge: Pick<MapConnectionEdge, 'isStatic' | 'jumpMassClass' | 'eolStage'>,
): ConnectionBadge[] {
  const badges: ConnectionBadge[] = [];
  if (edge.isStatic) badges.push({ key: 'static', label: 'STATIC' });
  if (edge.jumpMassClass) {
    badges.push({
      key: 'size',
      label: edge.jumpMassClass.toUpperCase(),
      tone: edge.jumpMassClass === 's' ? 'warn' : undefined,
    });
  }
  if (edge.eolStage === 'expired') badges.push({ key: 'eol', label: 'EXPIRED', tone: 'danger' });
  else if (edge.eolStage === 'critical') badges.push({ key: 'eol', label: 'EOL 1h' });
  else if (edge.eolStage === 'eol') badges.push({ key: 'eol', label: 'EOL' });
  return badges;
}
