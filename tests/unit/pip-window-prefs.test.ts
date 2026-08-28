import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PIP_WINDOW_SIZE,
  PIP_WINDOW_SIZE_KEY,
  readPipWindowSize,
  writePipWindowSize,
} from '@/lib/pipWindowPrefs';

function seed(raw: string): void {
  localStorage.setItem(PIP_WINDOW_SIZE_KEY, raw);
}

describe('pipWindowPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips a valid size', () => {
    writePipWindowSize({ width: 240, height: 500 });
    expect(readPipWindowSize()).toEqual({ width: 240, height: 500 });
  });

  it('returns null when nothing is stored', () => {
    expect(readPipWindowSize()).toBeNull();
  });

  // A closing PiP window reports 0×0; replaying that makes Chromium substitute
  // its own default size, which is the bug this guard exists for.
  it('refuses to store a zeroed size', () => {
    writePipWindowSize({ width: 300, height: 400 });
    writePipWindowSize({ width: 0, height: 0 });
    expect(readPipWindowSize()).toEqual({ width: 300, height: 400 });
  });

  it.each([
    ['zeros', '{"width":0,"height":0}'],
    ['negatives', '{"width":-200,"height":-300}'],
    ['NaN via null', '{"width":null,"height":320}'],
    ['below the minimum', '{"width":40,"height":320}'],
    ['above the maximum', '{"width":260,"height":99999}'],
    ['missing height', '{"width":260}'],
    ['wrong types', '{"width":"260","height":"320"}'],
    ['not an object', '"260x320"'],
    ['malformed JSON', '{width:260'],
  ])('rejects a stored size with %s', (_label, raw) => {
    seed(raw);
    expect(readPipWindowSize()).toBeNull();
  });

  it('rejects a NaN dimension', () => {
    writePipWindowSize({ width: Number.NaN, height: 320 });
    expect(readPipWindowSize()).toBeNull();
  });

  it('survives an unreadable store', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    expect(readPipWindowSize()).toBeNull();
  });

  it('survives an unwritable store', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    expect(() => writePipWindowSize({ width: 260, height: 320 })).not.toThrow();
  });

  it('exposes a default within the accepted range', () => {
    writePipWindowSize(DEFAULT_PIP_WINDOW_SIZE);
    expect(readPipWindowSize()).toEqual(DEFAULT_PIP_WINDOW_SIZE);
  });
});
