import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOUND_PREFS,
  MAX_SYSTEM_SOUND_MUTES,
  SOUND_EVENTS,
  isCueMutedInSystem,
  isSoundId,
  isSystemMuteListFull,
  removeSystemSoundMute,
  resolveSoundPrefs,
  setSystemSoundMute,
  soundMutesFor,
  soundPrefsSchema,
  type SoundPrefs,
  type SystemSoundMute,
} from '@/lib/sounds/prefs';

const CUSTOM_ID = 'custom:2f1c9e40-5a3b-4c1d-9e88-77b1a0c3de55';

describe('resolveSoundPrefs', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'loud'],
    ['a number', 42],
    ['an array', []],
    ['an empty object', {}],
    ['a wrong-typed events key', { events: 'all' }],
  ])('fills every default from %s', (_label, raw) => {
    expect(resolveSoundPrefs(raw)).toEqual(DEFAULT_SOUND_PREFS);
  });

  it('keeps the fields a partial object supplies and defaults the rest', () => {
    const resolved = resolveSoundPrefs({
      enabled: true,
      events: { pilotArrived: { enabled: true } },
    });
    expect(resolved.enabled).toBe(true);
    expect(resolved.volume).toBe(DEFAULT_SOUND_PREFS.volume);
    expect(resolved.events.pilotArrived).toEqual({ enabled: true, sound: 'chime-up' });
    expect(resolved.events.pilotLeft).toEqual(DEFAULT_SOUND_PREFS.events.pilotLeft);
  });

  it('always resolves every event in the vocabulary', () => {
    const resolved = resolveSoundPrefs({ events: { pilotArrived: { enabled: true } } });
    expect(Object.keys(resolved.events).sort()).toEqual([...SOUND_EVENTS].sort());
  });

  it.each([
    ['a non-number', 'loud', DEFAULT_SOUND_PREFS.volume],
    ['NaN', Number.NaN, DEFAULT_SOUND_PREFS.volume],
    ['above the range', 5, 1],
    ['below the range', -1, 0],
    ['in range', 0.25, 0.25],
  ])('resolves a volume that is %s', (_label, volume, expected) => {
    expect(resolveSoundPrefs({ volume }).volume).toBe(expected);
  });

  it('falls back to the default chime for an unknown sound id', () => {
    const resolved = resolveSoundPrefs({
      events: { watchedJump: { enabled: true, sound: 'foghorn' } },
    });
    expect(resolved.events.watchedJump).toEqual({ enabled: true, sound: 'tick' });
  });

  it('keeps a well-formed custom sound id', () => {
    const resolved = resolveSoundPrefs({
      events: { pilotLeft: { enabled: true, sound: CUSTOM_ID } },
    });
    expect(resolved.events.pilotLeft.sound).toBe(CUSTOM_ID);
  });

  it('rejects a malformed custom sound id', () => {
    const resolved = resolveSoundPrefs({ events: { pilotLeft: { sound: 'custom:nope' } } });
    expect(resolved.events.pilotLeft.sound).toBe('chime-down');
  });

  it('does not mutate the shared defaults', () => {
    const resolved = resolveSoundPrefs(null);
    resolved.events.pilotArrived.enabled = true;
    expect(DEFAULT_SOUND_PREFS.events.pilotArrived.enabled).toBe(false);
  });
});

describe('isSoundId', () => {
  it.each(['chime-up', 'chime-down', 'tick', 'alarm', CUSTOM_ID])('accepts %s', (id) => {
    expect(isSoundId(id)).toBe(true);
  });

  it.each([['foghorn'], ['custom:'], ['custom:not-a-uuid'], [''], [7], [null]])(
    'rejects %s',
    (id) => {
      expect(isSoundId(id)).toBe(false);
    },
  );
});

describe('soundPrefsSchema', () => {
  function valid(): SoundPrefs {
    return resolveSoundPrefs(null);
  }

  it('accepts the defaults', () => {
    expect(soundPrefsSchema.safeParse(DEFAULT_SOUND_PREFS).success).toBe(true);
  });

  it('accepts a custom sound id', () => {
    const prefs = valid();
    prefs.events.killInSystem.sound = CUSTOM_ID;
    expect(soundPrefsSchema.safeParse(prefs).success).toBe(true);
  });

  it.each([
    ['null', null],
    ['a missing events key', { enabled: true, volume: 0.5 }],
    ['a missing event', { enabled: true, volume: 0.5, events: { pilotArrived: {} } }],
    ['a string volume', { ...DEFAULT_SOUND_PREFS, volume: '0.5' }],
  ])('rejects %s', (_label, raw) => {
    expect(soundPrefsSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects an out-of-range volume', () => {
    const prefs = valid();
    prefs.volume = 1.5;
    expect(soundPrefsSchema.safeParse(prefs).success).toBe(false);
  });

  it('rejects an unknown sound id', () => {
    const prefs = valid();
    prefs.events.pilotArrived.sound = 'foghorn' as never;
    expect(soundPrefsSchema.safeParse(prefs).success).toBe(false);
  });
});

const JITA = { systemId: 30000142, name: 'Jita', isHome: false };
const HOME = { systemId: 31000001, name: 'J100001', isHome: true };

function muteEntry(systemId: number, patch: Partial<SystemSoundMute> = {}): SystemSoundMute {
  return { systemId, name: `S${systemId}`, kills: true, pilots: false, alerts: false, ...patch };
}

describe('system mutes', () => {
  it('defaults Home to muting pilots only', () => {
    const prefs = resolveSoundPrefs(null);
    expect(prefs.homeMutes).toEqual({ kills: false, pilots: true, alerts: false });
    expect(prefs.systemMutes).toEqual([]);
  });

  it('applies the Home mutes only to a system flagged as Home', () => {
    const prefs = resolveSoundPrefs(null);
    expect(isCueMutedInSystem(prefs, 'pilotArrived', HOME)).toBe(true);
    expect(isCueMutedInSystem(prefs, 'pilotLeft', HOME)).toBe(true);
    expect(isCueMutedInSystem(prefs, 'killInSystem', HOME)).toBe(false);
    expect(isCueMutedInSystem(prefs, 'pilotArrived', { ...HOME, isHome: false })).toBe(false);
  });

  it('never mutes a watched-wormhole cue', () => {
    let prefs = resolveSoundPrefs(null);
    for (const group of ['kills', 'pilots', 'alerts'] as const) {
      prefs = setSystemSoundMute(prefs, JITA, group, true);
      prefs = setSystemSoundMute(prefs, HOME, group, true);
    }
    expect(isCueMutedInSystem(prefs, 'watchedJump', JITA)).toBe(false);
    expect(isCueMutedInSystem(prefs, 'watchedJump', HOME)).toBe(false);
  });

  it('maps each cue to its group', () => {
    const prefs = setSystemSoundMute(resolveSoundPrefs(null), JITA, 'alerts', true);
    expect(isCueMutedInSystem(prefs, 'rallySet', JITA)).toBe(true);
    expect(isCueMutedInSystem(prefs, 'systemPinged', JITA)).toBe(true);
    expect(isCueMutedInSystem(prefs, 'killInSystem', JITA)).toBe(false);
    expect(isCueMutedInSystem(prefs, 'pilotArrived', JITA)).toBe(false);
  });

  it('adds an entry on mute and drops it once nothing is muted', () => {
    let prefs = setSystemSoundMute(resolveSoundPrefs(null), JITA, 'kills', true);
    expect(prefs.systemMutes).toEqual([
      { systemId: JITA.systemId, name: 'Jita', kills: true, pilots: false, alerts: false },
    ]);
    prefs = setSystemSoundMute(prefs, JITA, 'pilots', true);
    expect(prefs.systemMutes).toHaveLength(1);
    prefs = setSystemSoundMute(prefs, JITA, 'kills', false);
    prefs = setSystemSoundMute(prefs, JITA, 'pilots', false);
    expect(prefs.systemMutes).toEqual([]);
  });

  it('writes Home mutes, not an entry, when muting the Home system', () => {
    const prefs = setSystemSoundMute(resolveSoundPrefs(null), HOME, 'kills', true);
    expect(prefs.homeMutes.kills).toBe(true);
    expect(prefs.systemMutes).toEqual([]);
  });

  it('clears both sources when unmuting the Home system', () => {
    const base = resolveSoundPrefs(null);
    base.systemMutes = [muteEntry(HOME.systemId, { kills: false, pilots: true })];
    expect(soundMutesFor(base, HOME).pilots).toBe(true);
    const prefs = setSystemSoundMute(base, HOME, 'pilots', false);
    expect(soundMutesFor(prefs, HOME).pilots).toBe(false);
    expect(prefs.homeMutes.pilots).toBe(false);
    expect(prefs.systemMutes).toEqual([]);
  });

  it('refuses a new entry past the cap but still edits listed systems and Home', () => {
    const base = resolveSoundPrefs(null);
    base.systemMutes = Array.from({ length: MAX_SYSTEM_SOUND_MUTES }, (_, i) => muteEntry(i + 1));
    expect(isSystemMuteListFull(base, JITA)).toBe(true);
    expect(setSystemSoundMute(base, JITA, 'kills', true)).toBe(base);
    expect(isSystemMuteListFull(base, HOME)).toBe(false);
    expect(setSystemSoundMute(base, HOME, 'kills', true).homeMutes.kills).toBe(true);
    const listed = { systemId: 1, name: 'S1', isHome: false };
    expect(isSystemMuteListFull(base, listed)).toBe(false);
    expect(setSystemSoundMute(base, listed, 'alerts', true).systemMutes[0]?.alerts).toBe(true);
  });

  it('removes an entry outright', () => {
    const base = resolveSoundPrefs(null);
    base.systemMutes = [muteEntry(1), muteEntry(2)];
    expect(removeSystemSoundMute(base, 1).systemMutes.map((m) => m.systemId)).toEqual([2]);
  });

  it('resolves only well-formed, distinct, non-empty entries', () => {
    const resolved = resolveSoundPrefs({
      homeMutes: { kills: true, pilots: 'yes' },
      systemMutes: [
        muteEntry(1),
        muteEntry(1, { name: 'dupe' }),
        muteEntry(2, { kills: false }),
        { systemId: -3, name: 'bad', kills: true },
        { systemId: 4, name: '', kills: true },
        'junk',
        muteEntry(5, { alerts: true }),
      ],
    });
    expect(resolved.homeMutes).toEqual({ kills: true, pilots: true, alerts: false });
    expect(resolved.systemMutes.map((m) => m.systemId)).toEqual([1, 5]);
    expect(resolved.systemMutes[0]?.name).toBe('S1');
  });

  it('caps the resolved list', () => {
    const resolved = resolveSoundPrefs({
      systemMutes: Array.from({ length: MAX_SYSTEM_SOUND_MUTES + 5 }, (_, i) => muteEntry(i + 1)),
    });
    expect(resolved.systemMutes).toHaveLength(MAX_SYSTEM_SOUND_MUTES);
  });
});

describe('soundPrefsSchema system mutes', () => {
  it('accepts a populated mute list', () => {
    const prefs = setSystemSoundMute(resolveSoundPrefs(null), JITA, 'kills', true);
    expect(soundPrefsSchema.safeParse(prefs).success).toBe(true);
  });

  it.each([
    ['a missing homeMutes', (p: SoundPrefs) => ({ ...p, homeMutes: undefined })],
    ['a missing systemMutes', (p: SoundPrefs) => ({ ...p, systemMutes: undefined })],
    ['a repeated system', (p: SoundPrefs) => ({ ...p, systemMutes: [muteEntry(1), muteEntry(1)] })],
    [
      'a list past the cap',
      (p: SoundPrefs) => ({
        ...p,
        systemMutes: Array.from({ length: MAX_SYSTEM_SOUND_MUTES + 1 }, (_, i) => muteEntry(i + 1)),
      }),
    ],
    ['an empty name', (p: SoundPrefs) => ({ ...p, systemMutes: [muteEntry(1, { name: '' })] })],
  ])('rejects %s', (_label, mutate) => {
    expect(soundPrefsSchema.safeParse(mutate(resolveSoundPrefs(null))).success).toBe(false);
  });
});
