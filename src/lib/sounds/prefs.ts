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

export type SoundPrefs = {
  enabled: boolean;
  /** Master gain, 0..1. */
  volume: number;
  events: Record<SoundEvent, SoundEventPrefs>;
};

export const DEFAULT_SOUND_VOLUME = 0.7;

/** Everything off — sounds are opt-in. */
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
};

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
  };
}
