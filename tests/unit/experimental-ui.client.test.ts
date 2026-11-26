// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AP_UI_COOKIE,
  readExperimentalUiFromHtml,
  writeExperimentalUi,
} from '@/lib/experimentalUi';

describe('experimentalUi client helpers', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-ui');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-variant');
    document.cookie = '';
  });

  it('readExperimentalUiFromHtml returns off without experimental data-ui', () => {
    expect(readExperimentalUiFromHtml()).toBe('off');
  });

  it('readExperimentalUiFromHtml reads data-variant when set', () => {
    document.documentElement.setAttribute('data-ui', 'experimental');
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-variant', 'slate');
    expect(readExperimentalUiFromHtml()).toBe('slate');
  });

  it('writeExperimentalUi sets attributes and cookie for aperture', () => {
    writeExperimentalUi('aperture');
    expect(document.documentElement.getAttribute('data-ui')).toBe('experimental');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-variant')).toBe('aperture');
    expect(document.cookie).toBe(`${AP_UI_COOKIE}=exp-dark`);
  });

  it('writeExperimentalUi clears attributes and cookie when off', () => {
    writeExperimentalUi('aperture');
    writeExperimentalUi('off');
    expect(document.documentElement.hasAttribute('data-ui')).toBe(false);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.cookie).toBe('');
  });
});
