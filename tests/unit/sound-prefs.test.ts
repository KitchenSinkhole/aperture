import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOUND_PREFS,
  SOUND_EVENTS,
  isSoundId,
  resolveSoundPrefs,
  soundPrefsSchema,
  type SoundPrefs,
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
