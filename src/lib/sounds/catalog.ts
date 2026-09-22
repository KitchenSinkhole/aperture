import {
  DEFAULT_SOUND_PREFS,
  SOUND_EVENTS,
  VOICE_PACKS,
  type ChimeSoundId,
  type SoundEvent,
  type SoundId,
  type SoundVariant,
  type VoicePackId,
  type VoiceSoundId,
} from './prefs';

/**
 * Everything the app can play out of the box: the chimes, synthesized into an
 * `AudioBuffer` on first use rather than shipped as files, and the recorded
 * voice packs served from `public/sounds/voice/`. Also owns the human-readable
 * labels for every sound and every sound event, so the settings dialog renders
 * from here.
 */

export type ChimeSound = {
  kind: 'chime';
  id: ChimeSoundId;
  label: string;
  /** Renders the chime into a buffer belonging to `ctx`. */
  synth: (ctx: BaseAudioContext) => AudioBuffer;
};

export type VoiceSound = {
  kind: 'voice';
  id: VoiceSoundId;
  label: string;
  pack: VoicePackId;
  event: SoundEvent;
  /** One file per variant; an event with a single line points all three at it. */
  files: Record<SoundVariant, string>;
};

export type BuiltInSound = ChimeSound | VoiceSound;

type Tone = {
  freq: number;
  startMs: number;
  durMs: number;
  gain: number;
  wave: 'sine' | 'square';
};

const SAMPLE_RATE_FALLBACK = 44_100;

/**
 * Sums a handful of enveloped tones into a mono buffer. Every tone gets a
 * short linear attack and an exponential decay so nothing clicks at its edges.
 */
function render(ctx: BaseAudioContext, tones: Tone[]): AudioBuffer {
  const sampleRate = ctx.sampleRate > 0 ? ctx.sampleRate : SAMPLE_RATE_FALLBACK;
  const totalMs = Math.max(...tones.map((p) => p.startMs + p.durMs));
  const length = Math.max(1, Math.ceil((totalMs / 1000) * sampleRate));
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  for (const p of tones) {
    const start = Math.floor((p.startMs / 1000) * sampleRate);
    const frames = Math.max(1, Math.floor((p.durMs / 1000) * sampleRate));
    const attack = Math.max(1, Math.floor(0.008 * sampleRate));
    for (let i = 0; i < frames; i += 1) {
      const index = start + i;
      if (index >= length) break;
      const t = i / sampleRate;
      const phase = 2 * Math.PI * p.freq * t;
      const wave = p.wave === 'square' ? (Math.sin(phase) >= 0 ? 1 : -1) : Math.sin(phase);
      const attackGain = i < attack ? i / attack : 1;
      const decay = Math.exp((-5 * i) / frames);
      data[index] = (data[index] ?? 0) + wave * p.gain * attackGain * decay;
    }
  }

  // Keep the sum inside [-1, 1] so overlapping tones cannot clip.
  let peak = 0;
  for (let i = 0; i < length; i += 1) peak = Math.max(peak, Math.abs(data[i] ?? 0));
  if (peak > 1) for (let i = 0; i < length; i += 1) data[i] = (data[i] ?? 0) / peak;

  return buffer;
}

/** The chimes, in catalog order — the options every event's picker offers. */
export const CHIME_SOUNDS: readonly ChimeSound[] = [
  {
    kind: 'chime',
    id: 'chime-up',
    label: 'Chime (rising)',
    synth: (ctx) =>
      render(ctx, [
        { freq: 659.25, startMs: 0, durMs: 180, gain: 0.5, wave: 'sine' },
        { freq: 987.77, startMs: 110, durMs: 260, gain: 0.5, wave: 'sine' },
      ]),
  },
  {
    kind: 'chime',
    id: 'chime-down',
    label: 'Chime (falling)',
    synth: (ctx) =>
      render(ctx, [
        { freq: 987.77, startMs: 0, durMs: 180, gain: 0.5, wave: 'sine' },
        { freq: 659.25, startMs: 110, durMs: 260, gain: 0.5, wave: 'sine' },
      ]),
  },
  {
    kind: 'chime',
    id: 'arpeggio',
    label: 'Arpeggio',
    synth: (ctx) =>
      render(ctx, [
        { freq: 523.25, startMs: 0, durMs: 220, gain: 0.4, wave: 'sine' },
        { freq: 659.25, startMs: 90, durMs: 220, gain: 0.4, wave: 'sine' },
        { freq: 783.99, startMs: 180, durMs: 360, gain: 0.45, wave: 'sine' },
      ]),
  },
  {
    kind: 'chime',
    id: 'tick',
    label: 'Tick',
    synth: (ctx) =>
      render(ctx, [{ freq: 1480, startMs: 0, durMs: 55, gain: 0.45, wave: 'sine' }]),
  },
  {
    kind: 'chime',
    id: 'tick-loud',
    label: 'Tick (loud)',
    synth: (ctx) =>
      render(ctx, [
        { freq: 1480, startMs: 0, durMs: 90, gain: 0.7, wave: 'sine' },
        { freq: 2960, startMs: 0, durMs: 60, gain: 0.25, wave: 'sine' },
        { freq: 1480, startMs: 130, durMs: 90, gain: 0.7, wave: 'sine' },
        { freq: 2960, startMs: 130, durMs: 60, gain: 0.25, wave: 'sine' },
      ]),
  },
  {
    kind: 'chime',
    id: 'ping',
    label: 'Ping',
    synth: (ctx) =>
      render(ctx, [
        { freq: 1318.51, startMs: 0, durMs: 600, gain: 0.5, wave: 'sine' },
        { freq: 2637.02, startMs: 0, durMs: 350, gain: 0.15, wave: 'sine' },
      ]),
  },
  {
    // Bell partials are deliberately inharmonic; integer multiples sound like an organ.
    kind: 'chime',
    id: 'bell',
    label: 'Bell',
    synth: (ctx) =>
      render(ctx, [
        { freq: 440, startMs: 0, durMs: 1100, gain: 0.45, wave: 'sine' },
        { freq: 1214, startMs: 0, durMs: 700, gain: 0.2, wave: 'sine' },
        { freq: 2376, startMs: 0, durMs: 400, gain: 0.1, wave: 'sine' },
      ]),
  },
  {
    kind: 'chime',
    id: 'beeps',
    label: 'Beeps',
    synth: (ctx) =>
      render(ctx, [
        { freq: 880, startMs: 0, durMs: 70, gain: 0.3, wave: 'square' },
        { freq: 880, startMs: 110, durMs: 70, gain: 0.3, wave: 'square' },
        { freq: 880, startMs: 220, durMs: 70, gain: 0.3, wave: 'square' },
      ]),
  },
  {
    kind: 'chime',
    id: 'alarm',
    label: 'Alarm',
    synth: (ctx) =>
      render(ctx, [
        { freq: 320, startMs: 0, durMs: 150, gain: 0.35, wave: 'square' },
        { freq: 244, startMs: 150, durMs: 230, gain: 0.35, wave: 'square' },
      ]),
  },
  {
    kind: 'chime',
    id: 'klaxon',
    label: 'Klaxon',
    synth: (ctx) =>
      render(ctx, [
        { freq: 620, startMs: 0, durMs: 160, gain: 0.35, wave: 'square' },
        { freq: 465, startMs: 160, durMs: 160, gain: 0.35, wave: 'square' },
        { freq: 620, startMs: 320, durMs: 160, gain: 0.35, wave: 'square' },
        { freq: 465, startMs: 480, durMs: 260, gain: 0.35, wave: 'square' },
      ]),
  },
];

/**
 * The recorded files are named by the pack's display directory and a per-event
 * stem, with the watched-jump line suffixed by its variant.
 */
const VOICE_PACK_DIRS: Record<VoicePackId, string> = {
  ada: 'Ada',
  cowboy: 'Cowboy',
  malyx: 'Malyx',
};

const VOICE_EVENT_STEMS: Record<SoundEvent, string> = {
  pilotArrived: 'arrive',
  pilotLeft: 'leave',
  watchedJump: 'watched',
  killInSystem: 'kill',
  rallySet: 'rally',
  systemPinged: 'ping',
};

const VOICE_VARIANTS: readonly SoundVariant[] = ['plain', 'inbound', 'outbound'];

function voiceFiles(pack: VoicePackId, event: SoundEvent): Record<SoundVariant, string> {
  const dir = VOICE_PACK_DIRS[pack];
  const stem = VOICE_EVENT_STEMS[event];
  const path = (suffix: string) => `/sounds/voice/${dir}/${dir}-${stem}${suffix}.mp3`;
  if (event !== 'watchedJump') {
    const single = path('');
    return { plain: single, inbound: single, outbound: single };
  }
  return {
    plain: path('_plain'),
    inbound: path('_inbound'),
    outbound: path('_outbound'),
  };
}

const VOICE_SOUNDS: readonly VoiceSound[] = VOICE_PACKS.flatMap((pack) =>
  SOUND_EVENTS.map(
    (event): VoiceSound => ({
      kind: 'voice',
      id: `voice-${pack.id}-${event}`,
      label: pack.label,
      pack: pack.id,
      event,
      files: voiceFiles(pack.id, event),
    }),
  ),
);

export const BUILT_IN_SOUNDS: readonly BuiltInSound[] = [...CHIME_SOUNDS, ...VOICE_SOUNDS];

const BY_ID = new Map<string, BuiltInSound>(BUILT_IN_SOUNDS.map((s) => [s.id, s]));

/** The catalog entry for `id`, or `undefined` for a custom or unknown id. */
export function getBuiltInSound(id: SoundId): BuiltInSound | undefined {
  return BY_ID.get(id);
}

/** The one voice entry each pack contributes to `event`'s picker. */
export function voiceSoundsForEvent(event: SoundEvent): readonly VoiceSound[] {
  return VOICE_SOUNDS.filter((s) => s.event === event);
}

/** Every distinct file `id` needs, empty for a chime or an unknown id. */
export function soundFilesFor(id: SoundId): readonly string[] {
  const entry = getBuiltInSound(id);
  if (entry?.kind !== 'voice') return [];
  return [...new Set(VOICE_VARIANTS.map((v) => entry.files[v]))];
}

/** The chime an event falls back to when its chosen sound is unavailable. */
export function defaultSoundForEvent(event: SoundEvent): SoundId {
  return DEFAULT_SOUND_PREFS.events[event].sound;
}

/** Labels for the settings dialog's per-event rows. */
export const SOUND_EVENT_LABELS: Record<SoundEvent, { label: string; description: string }> = {
  pilotArrived: {
    label: 'Pilot arrives',
    description: 'A tracked pilot jumps into the system you are in.',
  },
  pilotLeft: {
    label: 'Pilot leaves',
    description: 'A tracked pilot jumps out of the system you are in.',
  },
  watchedJump: {
    label: 'Watched wormhole',
    description: 'A tracked pilot jumps a wormhole you are watching.',
  },
  killInSystem: {
    label: 'Kill on the map',
    description: 'A killmail lands in a system on this map.',
  },
  rallySet: {
    label: 'Rally set',
    description: 'Someone sets a rally point on a system on this map.',
  },
  systemPinged: {
    label: 'System pinged',
    description: 'Someone pings a system on this map.',
  },
};
