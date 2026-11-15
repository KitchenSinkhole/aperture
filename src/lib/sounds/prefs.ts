import { z } from 'zod';

/**
 * Sound-cue vocabulary and the account-level preference blob stored on
 * `ap_user.sound_prefs`. Pure: no browser and no server imports, so a Server
 * Action, the session reader and client code can all share it.
 */

/** Every cue the engine knows how to play. */
export const SOUND_EVENTS = [
  'pilotArrived',
  'pilotLeft',
  'watchedJump',
  'killInSystem',
  'rallySet',
  'systemPinged',
] as const;

export type SoundEvent = (typeof SOUND_EVENTS)[number];

/** Chimes synthesized by `catalog.ts`. */
export const CHIME_SOUND_IDS = [
  'chime-up',
  'chime-down',
  'arpeggio',
  'tick',
  'tick-loud',
  'ping',
  'bell',
  'beeps',
  'alarm',
  'klaxon',
] as const;

export type ChimeSoundId = (typeof CHIME_SOUND_IDS)[number];

/** Recorded voice packs shipped under `public/sounds/voice/`. */
export const VOICE_PACKS = [
  { id: 'ada', label: 'Ada' },
  { id: 'cowboy', label: 'Cowboy' },
  { id: 'malyx', label: 'Malyx' },
] as const;

export type VoicePack = (typeof VOICE_PACKS)[number];

export type VoicePackId = VoicePack['id'];

/** One recorded line per pack per event; the watched-jump line splits by variant. */
export type VoiceSoundId = `voice-${VoicePackId}-${SoundEvent}`;

export const VOICE_SOUND_IDS: readonly VoiceSoundId[] = VOICE_PACKS.flatMap((pack) =>
  SOUND_EVENTS.map((event): VoiceSoundId => `voice-${pack.id}-${event}`),
);

export type BuiltInSoundId = ChimeSoundId | VoiceSoundId;

/** Every id the app ships, as opposed to a `custom:` id imported on one device. */
export const BUILT_IN_SOUND_IDS: readonly BuiltInSoundId[] = [
  ...CHIME_SOUND_IDS,
  ...VOICE_SOUND_IDS,
];

/** A sound file the user imported on this device (`customStore.ts`). */
export type CustomSoundId = `custom:${string}`;

export type SoundId = BuiltInSoundId | CustomSoundId;

/**
 * Which end of a watched wormhole the viewer sits on. Built-in chimes ignore
 * it; the voice pack speaks a different line per variant.
 */
export type SoundVariant = 'plain' | 'inbound' | 'outbound';

export type SoundEventPrefs = {
  enabled: boolean;
  sound: SoundId;
};

/** The cue groups a system can be muted for. */
export const SOUND_MUTE_GROUPS = ['kills', 'pilots', 'alerts'] as const;

export type SoundMuteGroup = (typeof SOUND_MUTE_GROUPS)[number];

/**
 * Which mute group silences each cue. `watchedJump` has none: watching a
 * wormhole is already an explicit opt-in, so no system mute overrides it.
 */
export const SOUND_MUTE_GROUP_OF: Record<SoundEvent, SoundMuteGroup | null> = {
  pilotArrived: 'pilots',
  pilotLeft: 'pilots',
  watchedJump: null,
  killInSystem: 'kills',
  rallySet: 'alerts',
  systemPinged: 'alerts',
};

/** `true` ⇒ that group's cues stay silent in the system. */
export type SoundMutes = Record<SoundMuteGroup, boolean>;

/** A per-system mute, keyed by EVE solar-system id so it holds on every map. */
export type SystemSoundMute = SoundMutes & {
  systemId: number;
  /** Display name for the settings list, which has no universe lookup of its own. */
  name: string;
};

/** Cap on `systemMutes`, so the account blob stays bounded. */
export const MAX_SYSTEM_SOUND_MUTES = 50;

export type SoundPrefs = {
  enabled: boolean;
  /** Master gain, 0..1. */
  volume: number;
  events: Record<SoundEvent, SoundEventPrefs>;
  /** Applied to whichever system is the Home of the map being viewed. */
  homeMutes: SoundMutes;
  /** Only entries with at least one group muted. */
  systemMutes: SystemSoundMute[];
};

export const DEFAULT_SOUND_VOLUME = 0.7;

/** Everything off — sounds are opt-in. Home mutes pilot arrivals and departures. */
export const DEFAULT_SOUND_PREFS: SoundPrefs = {
  enabled: false,
  volume: DEFAULT_SOUND_VOLUME,
  events: {
    pilotArrived: { enabled: false, sound: 'chime-up' },
    pilotLeft: { enabled: false, sound: 'chime-down' },
    watchedJump: { enabled: false, sound: 'tick' },
    killInSystem: { enabled: false, sound: 'alarm' },
    rallySet: { enabled: false, sound: 'bell' },
    systemPinged: { enabled: false, sound: 'ping' },
  },
  homeMutes: { kills: false, pilots: true, alerts: false },
  systemMutes: [],
};

/** The system a cue happened in, as the engine's mute gate sees it. */
export type SoundCueSystem = {
  /** EVE solar-system id. */
  systemId: number;
  /** Whether it is the Home of the map being viewed. */
  isHome: boolean;
};

const NO_MUTES: SoundMutes = { kills: false, pilots: false, alerts: false };

/** The groups muted in one system: its own entry together with the Home mutes when it is Home. */
export function soundMutesFor(prefs: SoundPrefs, system: SoundCueSystem): SoundMutes {
  const own = prefs.systemMutes.find((m) => m.systemId === system.systemId) ?? NO_MUTES;
  const home = system.isHome ? prefs.homeMutes : NO_MUTES;
  return {
    kills: own.kills || home.kills,
    pilots: own.pilots || home.pilots,
    alerts: own.alerts || home.alerts,
  };
}

/** Whether `event` is silenced in `system`. Always false for a cue with no mute group. */
export function isCueMutedInSystem(
  prefs: SoundPrefs,
  event: SoundEvent,
  system: SoundCueSystem,
): boolean {
  const group = SOUND_MUTE_GROUP_OF[event];
  return group != null && soundMutesFor(prefs, system)[group];
}

/**
 * Whether muting `group` in `system` needs a new `systemMutes` entry that the
 * cap no longer allows. Muting Home writes `homeMutes` and never needs one.
 */
export function isSystemMuteListFull(prefs: SoundPrefs, system: SoundCueSystem): boolean {
  if (system.isHome) return false;
  if (prefs.systemMutes.some((m) => m.systemId === system.systemId)) return false;
  return prefs.systemMutes.length >= MAX_SYSTEM_SOUND_MUTES;
}

/**
 * Mute or unmute one group in one system, so that `soundMutesFor` afterwards
 * reports exactly `muted` for it. Muting Home writes `homeMutes`; muting any
 * other system writes its `systemMutes` entry. Unmuting clears both, since
 * either one alone keeps the cue silent. An entry left with nothing muted is
 * dropped. A mute that would overflow the cap returns `prefs` unchanged.
 */
export function setSystemSoundMute(
  prefs: SoundPrefs,
  system: SoundCueSystem & { name: string },
  group: SoundMuteGroup,
  muted: boolean,
): SoundPrefs {
  if (muted && isSystemMuteListFull(prefs, system)) return prefs;
  const homeMutes = system.isHome ? { ...prefs.homeMutes, [group]: muted } : prefs.homeMutes;
  if (muted && system.isHome) return { ...prefs, homeMutes };

  const existing = prefs.systemMutes.find((m) => m.systemId === system.systemId);
  if (!existing && !muted) return { ...prefs, homeMutes };
  const entry: SystemSoundMute = {
    ...(existing ?? { ...NO_MUTES, systemId: system.systemId, name: system.name }),
    [group]: muted,
  };
  const others = prefs.systemMutes.filter((m) => m.systemId !== system.systemId);
  const systemMutes = !SOUND_MUTE_GROUPS.some((g) => entry[g])
    ? others
    : existing
      ? prefs.systemMutes.map((m) => (m.systemId === system.systemId ? entry : m))
      : [...prefs.systemMutes, entry];
  return { ...prefs, homeMutes, systemMutes };
}

/** Drop a system's entry from `systemMutes` outright. */
export function removeSystemSoundMute(prefs: SoundPrefs, systemId: number): SoundPrefs {
  return { ...prefs, systemMutes: prefs.systemMutes.filter((m) => m.systemId !== systemId) };
}

const CUSTOM_SOUND_ID_RE =
  /^custom:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Type guard for a built-in id or a well-formed `custom:<uuid>` id. */
export function isSoundId(value: unknown): value is SoundId {
  if (typeof value !== 'string') return false;
  return (
    (BUILT_IN_SOUND_IDS as readonly string[]).includes(value) || CUSTOM_SOUND_ID_RE.test(value)
  );
}

const soundIdSchema = z.custom<SoundId>(isSoundId, { message: 'unknown sound id' });

const soundEventPrefsSchema = z.object({
  enabled: z.boolean(),
  sound: soundIdSchema,
});

const soundMutesSchema = z.object({
  kills: z.boolean(),
  pilots: z.boolean(),
  alerts: z.boolean(),
});

const systemSoundMuteSchema = soundMutesSchema.extend({
  systemId: z.number().int().positive(),
  name: z.string().min(1).max(100),
});

// System boundary: the blob arrives from the settings dialog before it lands in
// `ap_user.sound_prefs`. Strict — a malformed blob is rejected rather than
// repaired, so a broken client cannot quietly rewrite the account's prefs.
export const soundPrefsSchema = z.object({
  enabled: z.boolean(),
  volume: z.number().min(0).max(1),
  events: z.object({
    pilotArrived: soundEventPrefsSchema,
    pilotLeft: soundEventPrefsSchema,
    watchedJump: soundEventPrefsSchema,
    killInSystem: soundEventPrefsSchema,
    rallySet: soundEventPrefsSchema,
    systemPinged: soundEventPrefsSchema,
  }),
  homeMutes: soundMutesSchema,
  systemMutes: z
    .array(systemSoundMuteSchema)
    .max(MAX_SYSTEM_SOUND_MUTES)
    .refine((list) => new Set(list.map((m) => m.systemId)).size === list.length, {
      message: 'duplicate system',
    }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveVolume(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_SOUND_VOLUME;
  return Math.min(1, Math.max(0, raw));
}

function resolveEventPrefs(raw: unknown, event: SoundEvent): SoundEventPrefs {
  const fallback = DEFAULT_SOUND_PREFS.events[event];
  if (!isRecord(raw)) return { ...fallback };
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled,
    sound: isSoundId(raw.sound) ? raw.sound : fallback.sound,
  };
}

function resolveMutes(raw: unknown, fallback: SoundMutes): SoundMutes {
  const src = isRecord(raw) ? raw : {};
  const out = { ...fallback };
  for (const group of SOUND_MUTE_GROUPS) {
    if (typeof src[group] === 'boolean') out[group] = src[group];
  }
  return out;
}

function resolveSystemMutes(raw: unknown): SystemSoundMute[] {
  if (!Array.isArray(raw)) return [];
  const out: SystemSoundMute[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (out.length >= MAX_SYSTEM_SOUND_MUTES) break;
    if (!isRecord(item)) continue;
    const { systemId, name } = item;
    if (typeof systemId !== 'number' || !Number.isInteger(systemId) || systemId <= 0) continue;
    if (typeof name !== 'string' || name === '' || seen.has(systemId)) continue;
    const mutes = resolveMutes(item, NO_MUTES);
    if (!SOUND_MUTE_GROUPS.some((g) => mutes[g])) continue;
    seen.add(systemId);
    out.push({ ...mutes, systemId, name });
  }
  return out;
}

/**
 * Read side of the same blob: fills every missing or mistyped field from
 * `DEFAULT_SOUND_PREFS` field by field, so a NULL column, a partial object or
 * outright garbage all yield usable prefs.
 */
export function resolveSoundPrefs(raw: unknown): SoundPrefs {
  const src = isRecord(raw) ? raw : {};
  const events = isRecord(src.events) ? src.events : {};
  const resolved = {} as Record<SoundEvent, SoundEventPrefs>;
  for (const event of SOUND_EVENTS) resolved[event] = resolveEventPrefs(events[event], event);
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_SOUND_PREFS.enabled,
    volume: resolveVolume(src.volume),
    events: resolved,
    homeMutes: resolveMutes(src.homeMutes, DEFAULT_SOUND_PREFS.homeMutes),
    systemMutes: resolveSystemMutes(src.systemMutes),
  };
}
