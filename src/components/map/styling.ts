import type { MapConnectionEdge, MapSystemNode } from '@/lib/map/loadMap';
import type { SystemEffectKey } from '@/lib/eve/systemEffects';
import type { NoteSeverity } from '@/lib/map/enumLabels';
import { roundSecurity } from '@/lib/sde/security';

// The map encodes status and connection state purely as colour/stroke, with
// explicit values so the canvas is readable without Tailwind tokens leaking
// into SVG.

export type MapStylePalette = 'default' | 'experimental';

export type MapStyleVariant = 'aperture' | 'slate' | 'light' | 'classic';

export type MapStyleOptions = {
  palette?: MapStylePalette;
  theme?: 'dark' | 'light';
  /** Experimental map link salience (importance-ordered strokes). */
  importanceLinks?: boolean;
  variant?: MapStyleVariant;
};

function resolved(opts?: MapStyleOptions): Required<Omit<MapStyleOptions, 'variant' | 'importanceLinks'>> & {
  importanceLinks: boolean;
  variant: MapStyleVariant;
} {
  return {
    palette: opts?.palette ?? 'default',
    theme: opts?.theme ?? 'dark',
    importanceLinks: opts?.importanceLinks ?? false,
    variant: opts?.variant ?? 'aperture',
  };
}

// Covers universe_system.security labels: H, L, 0.0, C1–C6, P (Pochven), A (Abyssal).
// C1–C6 progress from cool blue to orangy-red to signal increasing danger.
const DEFAULT_SYSTEM_CLASS_COLORS: Partial<Record<string, string>> = {
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

const EXPERIMENTAL_SYSTEM_CLASS_DARK: Partial<Record<string, string>> = {
  H: '#3DDC97',
  L: '#F0A04B',
  '0.0': '#F07167',
  P: '#E85D8C',
  A: '#2DD4C8',
  C1: '#5EC8FF',
  C2: '#3BA3F0',
  C3: '#C5D63A',
  C4: '#F5C518',
  C5: '#FF8A3D',
  C6: '#FF6B4A',
};

const EXPERIMENTAL_SYSTEM_CLASS_LIGHT: Partial<Record<string, string>> = {
  H: '#0B7A4B',
  L: '#C45C00',
  '0.0': '#B42318',
  P: '#9F1239',
  A: '#0F766E',
  C1: '#0369A1',
  C2: '#075985',
  C3: '#4D7C0F',
  C4: '#A16207',
  C5: '#C2410C',
  C6: '#9A3412',
};

function systemClassTable(opts?: MapStyleOptions) {
  const { palette, theme } = resolved(opts);
  if (palette === 'default') return DEFAULT_SYSTEM_CLASS_COLORS;
  return theme === 'light' ? EXPERIMENTAL_SYSTEM_CLASS_LIGHT : EXPERIMENTAL_SYSTEM_CLASS_DARK;
}

/** Colour for a `universe_system.security` or `universe_wormhole.target_class` label. */
export function systemClassColor(
  cls: string | null | undefined,
  opts?: MapStyleOptions,
): string {
  const table = systemClassTable(opts);
  const fallback = resolved(opts).palette === 'default' ? '#6b7280' : '#94A3B8';
  if (!cls) return fallback;
  return table[cls] ?? fallback;
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
  opts?: MapStyleOptions,
): string {
  if (
    resolved(opts).palette === 'default' &&
    securityStatus != null &&
    (label === 'H' || label === 'L' || label === '0.0')
  ) {
    return trueSecColor(securityStatus);
  }
  return systemClassColor(label, opts);
}

const DEFAULT_STATUS_COLORS: Record<MapSystemNode['status'], string> = {
  unknown: '#6b7280',
  friendly: '#3b82f6',
  occupied: '#f59e0b',
  hostile: '#ef4444',
  empty: '#22c55e',
  unscanned: '#a855f7',
};

const EXPERIMENTAL_STATUS_DARK: Record<MapSystemNode['status'], string> = {
  unknown: '#94A3B8',
  friendly: '#5B9DFF',
  occupied: '#F5B942',
  hostile: '#FF5C5C',
  empty: '#3DDC97',
  unscanned: '#C084FC',
};

const EXPERIMENTAL_STATUS_LIGHT: Record<MapSystemNode['status'], string> = {
  unknown: '#475569',
  friendly: '#1D4ED8',
  occupied: '#B45309',
  hostile: '#B91C1C',
  empty: '#0B7A4B',
  unscanned: '#7E22CE',
};

function statusColors(opts?: MapStyleOptions) {
  const { palette, theme } = resolved(opts);
  if (palette === 'default') return DEFAULT_STATUS_COLORS;
  return theme === 'light' ? EXPERIMENTAL_STATUS_LIGHT : EXPERIMENTAL_STATUS_DARK;
}

export function systemStatusColor(
  status: MapSystemNode['status'],
  opts?: MapStyleOptions,
): string {
  return statusColors(opts)[status];
}

// Reserved for the Home-system marker (accent ring + header icon). Kept distinct
// from the status palette so it never reads as a system status.
const DEFAULT_HOME_ACCENT = '#fbbf24';

/** Accent colour for the designated Home system's ring and header icon. */
export function homeAccentColor(opts?: MapStyleOptions): string {
  const { palette, theme } = resolved(opts);
  if (palette === 'default') return DEFAULT_HOME_ACCENT;
  return theme === 'light' ? '#B45309' : '#FBBF24';
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

const DEFAULT_MASS_COLORS: Record<MapConnectionEdge['massStatus'], string> = {
  fresh: '#84cc16',
  reduced: '#f59e0b',
  critical: '#ef4444',
};

const EXPERIMENTAL_MASS_DARK: Record<MapConnectionEdge['massStatus'], string> = {
  fresh: '#86EF63',
  reduced: '#F5B942',
  critical: '#FF5C5C',
};

const EXPERIMENTAL_MASS_LIGHT: Record<MapConnectionEdge['massStatus'], string> = {
  fresh: '#3F9C1F',
  reduced: '#B45309',
  critical: '#B91C1C',
};

const DEFAULT_SCOPE_COLORS: Record<MapConnectionEdge['scope'], string> = {
  wh: '#cbd5e1',
  stargate: '#4ade80',
  jumpbridge: '#a855f7',
  abyssal: '#f97316',
};

const EXPERIMENTAL_SCOPE_DARK: Record<MapConnectionEdge['scope'], string> = {
  wh: '#CBD5E1',
  stargate: '#4ADE80',
  jumpbridge: '#C084FC',
  abyssal: '#f97316',
};

const EXPERIMENTAL_SCOPE_LIGHT: Record<MapConnectionEdge['scope'], string> = {
  wh: '#334155',
  stargate: '#15803D',
  jumpbridge: '#7E22CE',
  abyssal: '#C2410C',
};

// Warp-bubble marker at a connection mouth. A cold, bright ice blue: held apart
// from the mass/scope palette so a bubble never reads as connection state, and
// high enough in luminance to carry against the near-black canvas at the low
// alphas the ring fill and wash use.
const DEFAULT_BUBBLE_COLOR = '#9ec9f0';

/** Fill/stroke hue for the bubbled-end marker and its wash. */
export function connectionBubbleColor(opts?: MapStyleOptions): string {
  const { palette, theme } = resolved(opts);
  if (palette === 'default') return DEFAULT_BUBBLE_COLOR;
  return theme === 'light' ? '#0369A1' : '#7DD3FC';
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
  strokeOpacity?: number;
};

const IMPORTANCE_WH_FRESH_DARK = { stroke: '#9ca3af', width: 2, opacity: 0.38 };
const IMPORTANCE_WH_FRESH_LIGHT = { stroke: '#94a3b8', width: 2, opacity: 0.34 };
const IMPORTANCE_WH_REDUCED_DARK = { stroke: '#f59e0b', width: 2.5, opacity: 0.95 };
const IMPORTANCE_WH_REDUCED_LIGHT = { stroke: '#b45309', width: 2.5, opacity: 1 };
const IMPORTANCE_WH_CRITICAL_DARK = { stroke: '#ef4444', width: 4, opacity: 1 };
const IMPORTANCE_WH_CRITICAL_LIGHT = { stroke: '#b91c1c', width: 4, opacity: 1 };
const IMPORTANCE_STARGATE_DARK = { stroke: '#64748b', width: 1.5, opacity: 0.35, dash: '2 5' as const };
const IMPORTANCE_STARGATE_LIGHT = { stroke: '#475569', width: 1.5, opacity: 0.4, dash: '2 5' as const };
const IMPORTANCE_CLASSIC_WH_FRESH = { stroke: '#3c3f41', width: 2, opacity: 0.85 };
const IMPORTANCE_CLASSIC_REDUCED = { stroke: '#e28a0d', width: 2.5, opacity: 1 };
const IMPORTANCE_CLASSIC_CRITICAL = { stroke: '#a52521', width: 4, opacity: 1 };
const IMPORTANCE_CLASSIC_STARGATE = { stroke: '#63676a', width: 2, opacity: 0.5, dash: '2 6' as const };

function importanceWhFresh(opts: MapStyleOptions | undefined) {
  const { theme, variant } = resolved(opts);
  if (variant === 'classic') return IMPORTANCE_CLASSIC_WH_FRESH;
  return theme === 'light' ? IMPORTANCE_WH_FRESH_LIGHT : IMPORTANCE_WH_FRESH_DARK;
}

/** Experimental outline classes when only the stored stage is known (fallback). */
export function experimentalEolOutlineClass(
  eolStage: MapConnectionEdge['eolStage'],
): string | null {
  if (eolStage === 'eol') return 'ap-connection-eol-outline ap-connection-eol-stage-eol';
  if (eolStage === 'critical' || eolStage === 'expired') {
    return 'ap-connection-eol-outline ap-connection-eol-stage-critical';
  }
  return null;
}

/** Experimental outline from live countdown urgency (`warning` orange, `critical` red). */
export function experimentalEolOutlineClassFromUrgency(
  urgency: 'warning' | 'critical' | null,
): string | null {
  if (urgency === 'critical') return 'ap-connection-eol-outline ap-connection-eol-stage-critical';
  if (urgency === 'warning') return 'ap-connection-eol-outline ap-connection-eol-stage-eol';
  return null;
}

export const EOL_URGENCY_COLORS = {
  warning: { text: '#f97316', border: '#f97316' },
  critical: { text: '#ef4444', border: '#ef4444' },
} as const;

/** Filled countdown pill on the connection tag — urgency colour stays on the pill only. */
export function experimentalEolCountdownPillClass(
  urgency: 'warning' | 'critical',
): string {
  return urgency === 'critical'
    ? 'ap-connection-eol-countdown-pill-critical'
    : 'ap-connection-eol-countdown-pill-warning';
}

function connectionImportanceStyle(
  edge: Pick<MapConnectionEdge, 'scope' | 'massStatus' | 'jumpMassClass' | 'eolStage'>,
  opts?: MapStyleOptions,
): EdgeStyle {
  const { variant } = resolved(opts);
  if (edge.scope === 'stargate') {
    const g = variant === 'classic' ? IMPORTANCE_CLASSIC_STARGATE : resolved(opts).theme === 'light'
      ? IMPORTANCE_STARGATE_LIGHT
      : IMPORTANCE_STARGATE_DARK;
    return {
      stroke: g.stroke,
      strokeWidth: g.width,
      strokeOpacity: g.opacity,
      strokeDasharray: g.dash,
    };
  }
  if (edge.scope !== 'wh') {
    const stroke = variant === 'classic' ? '#63676a' : '#94a3b8';
    return { stroke, strokeWidth: 2, strokeOpacity: 0.45 };
  }

  const mass =
    edge.massStatus === 'critical'
      ? variant === 'classic'
        ? IMPORTANCE_CLASSIC_CRITICAL
        : resolved(opts).theme === 'light'
          ? IMPORTANCE_WH_CRITICAL_LIGHT
          : IMPORTANCE_WH_CRITICAL_DARK
      : edge.massStatus === 'reduced'
        ? variant === 'classic'
          ? IMPORTANCE_CLASSIC_REDUCED
          : resolved(opts).theme === 'light'
            ? IMPORTANCE_WH_REDUCED_LIGHT
            : IMPORTANCE_WH_REDUCED_DARK
        : importanceWhFresh(opts);

  let dash: string | undefined;
  const size = edge.jumpMassClass;
  if (size === 's') dash = '3 4';
  else if (size === 'm') dash = '6 4';
  else if (size === 'xl') {
    return {
      stroke: mass.stroke,
      strokeWidth: (mass.width ?? 2) + 2,
      strokeOpacity: mass.opacity,
      strokeDasharray: undefined,
    };
  }

  return {
    stroke: mass.stroke,
    strokeWidth: mass.width,
    strokeOpacity: mass.opacity,
    strokeDasharray: dash,
  };
}

/**
 * Stroke styling for a connection. Scope picks the base colour; wormholes are
 * recoloured by mass status. EOL connections dash — the `critical` (1h) stage
 * dashes more tightly than the `eol` (4h) stage to read as more urgent, and the
 * manual `expired` stage dashes sparsest of all to read as barely-there; frigate
 * holes thin out.
 */
export function connectionStyle(
  edge: Pick<MapConnectionEdge, 'scope' | 'massStatus' | 'jumpMassClass' | 'eolStage'>,
  opts?: MapStyleOptions,
): EdgeStyle {
  const { palette, theme, importanceLinks } = resolved(opts);
  if (importanceLinks) {
    return connectionImportanceStyle(edge, opts);
  }
  const mass =
    palette === 'default'
      ? DEFAULT_MASS_COLORS
      : theme === 'light'
        ? EXPERIMENTAL_MASS_LIGHT
        : EXPERIMENTAL_MASS_DARK;
  const scope =
    palette === 'default'
      ? DEFAULT_SCOPE_COLORS
      : theme === 'light'
        ? EXPERIMENTAL_SCOPE_LIGHT
        : EXPERIMENTAL_SCOPE_DARK;
  const stroke = edge.scope === 'wh' ? mass[edge.massStatus] : scope[edge.scope];
  const strokeWidth = edge.jumpMassClass === 's' ? (palette === 'experimental' ? 2 : 1.5) : 3;
  return {
    stroke,
    strokeWidth,
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
  /** Live EOL countdown urgency for tag border + text colour. */
  eolUrgency?: 'warning' | 'critical';
};

/**
 * Text badges stacked on a connection: STATIC, jump-mass size, EOL. Rolling and
 * preserve-mass are surfaced as standalone icons by `ConnectionEdge`, not here,
 * because they carry enough operational weight to warrant a glyph over text.
 */
export function connectionBadges(
  edge: Pick<MapConnectionEdge, 'isStatic' | 'jumpMassClass' | 'eolStage'>,
  opts?: MapStyleOptions,
): ConnectionBadge[] {
  const badges: ConnectionBadge[] = [];
  if (edge.isStatic) badges.push({ key: 'static', label: 'STATIC' });
  const importance = resolved(opts).importanceLinks;
  const showSize =
    edge.jumpMassClass && (!importance || edge.jumpMassClass !== 'l');
  if (showSize) {
    badges.push({
      key: 'size',
      label: edge.jumpMassClass!.toUpperCase(),
      tone: edge.jumpMassClass === 's' ? 'warn' : undefined,
    });
  }
  if (edge.eolStage === 'expired') badges.push({ key: 'eol', label: 'EXPIRED', tone: 'danger' });
  else if (edge.eolStage === 'critical') badges.push({ key: 'eol', label: 'EOL' });
  else if (edge.eolStage === 'eol') badges.push({ key: 'eol', label: 'EOL' });
  return badges;
}
