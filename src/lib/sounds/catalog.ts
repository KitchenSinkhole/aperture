import {
  DEFAULT_SOUND_PREFS,
  type BuiltInSoundId,
  type SoundEvent,
  type SoundId,
} from './prefs';

/**
 * The built-in chimes, synthesized into an `AudioBuffer` on first use rather
 * than shipped as files — no assets, no fetch latency. Also owns the
 * human-readable labels for every sound and every sound event, so the settings
 * dialog renders from here.
 */

export type BuiltInSound = {
  id: BuiltInSoundId;
  label: string;
  /** Renders the chime into a buffer belonging to `ctx`. */
  synth: (ctx: BaseAudioContext) => AudioBuffer;
};

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

export const BUILT_IN_SOUNDS: readonly BuiltInSound[] = [
  {
    id: 'chime-up',
    label: 'Chime (rising)',
    synth: (ctx) =>
      render(ctx, [
        { freq: 659.25, startMs: 0, durMs: 180, gain: 0.5, wave: 'sine' },
        { freq: 987.77, startMs: 110, durMs: 260, gain: 0.5, wave: 'sine' },
      ]),
  },
  {
    id: 'chime-down',
    label: 'Chime (falling)',
    synth: (ctx) =>
      render(ctx, [
        { freq: 987.77, startMs: 0, durMs: 180, gain: 0.5, wave: 'sine' },
        { freq: 659.25, startMs: 110, durMs: 260, gain: 0.5, wave: 'sine' },
      ]),
  },
  {
    id: 'tick',
    label: 'Tick',
    synth: (ctx) =>
      render(ctx, [{ freq: 1480, startMs: 0, durMs: 55, gain: 0.45, wave: 'sine' }]),
  },
  {
    id: 'alarm',
    label: 'Alarm',
    synth: (ctx) =>
      render(ctx, [
        { freq: 320, startMs: 0, durMs: 150, gain: 0.35, wave: 'square' },
        { freq: 244, startMs: 150, durMs: 230, gain: 0.35, wave: 'square' },
      ]),
  },
];

const BY_ID = new Map<string, BuiltInSound>(BUILT_IN_SOUNDS.map((s) => [s.id, s]));

/** The catalog entry for `id`, or `undefined` for a custom or unknown id. */
export function getBuiltInSound(id: SoundId): BuiltInSound | undefined {
  return BY_ID.get(id);
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
};
