// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  AP_UI_COOKIE,
  experimentalUiHtmlAttributes,
  experimentalUiModeToCookieValue,
  parseApUiCookie,
} from '@/lib/experimentalUi';

describe('parseApUiCookie', () => {
  it.each([
    ['exp-dark', 'aperture'],
    ['exp-slate', 'slate'],
    ['exp-light', 'light'],
    ['exp-classic', 'classic'],
  ] as const)('maps %s to %s', (raw, mode) => {
    expect(parseApUiCookie(raw)).toBe(mode);
  });

  it.each(['', 'garbage', 'dark', 'exp', undefined])('treats %j as off', (raw) => {
    expect(parseApUiCookie(raw)).toBe('off');
  });
});

describe('experimentalUiModeToCookieValue', () => {
  it.each([
    ['aperture', 'exp-dark'],
    ['slate', 'exp-slate'],
    ['light', 'exp-light'],
    ['classic', 'exp-classic'],
    ['off', null],
  ] as const)('maps %s to %j', (mode, cookie) => {
    expect(experimentalUiModeToCookieValue(mode)).toBe(cookie);
  });
});

describe('experimentalUiHtmlAttributes', () => {
  it('returns empty when off', () => {
    expect(experimentalUiHtmlAttributes('off')).toEqual({});
  });

  it('sets data-ui, data-theme, and data-variant when active', () => {
    expect(experimentalUiHtmlAttributes('aperture')).toEqual({
      'data-ui': 'experimental',
      'data-theme': 'dark',
      'data-variant': 'aperture',
    });
    expect(experimentalUiHtmlAttributes('slate')).toEqual({
      'data-ui': 'experimental',
      'data-theme': 'dark',
      'data-variant': 'slate',
    });
    expect(experimentalUiHtmlAttributes('light')).toEqual({
      'data-ui': 'experimental',
      'data-theme': 'light',
      'data-variant': 'light',
    });
  });
});

describe('getExperimentalUiFromCookies', () => {
  it('reads the ap_ui cookie via next/headers', async () => {
    vi.doMock('next/headers', () => ({
      cookies: vi.fn(async () => ({
        get: (name: string) => (name === AP_UI_COOKIE ? { value: 'exp-light' } : undefined),
      })),
    }));
    const { getExperimentalUiFromCookies } = await import('@/lib/experimentalUi.server');
    await expect(getExperimentalUiFromCookies()).resolves.toBe('light');
    vi.doUnmock('next/headers');
  });
});
