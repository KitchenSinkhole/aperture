export const AP_UI_COOKIE = 'ap_ui';

const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** Experimental theme when `ap_ui` is on (`off` = legacy UI). */
export type ExperimentalUiMode = 'off' | 'aperture' | 'slate' | 'light' | 'classic';

/** Parse the raw `ap_ui` cookie (`exp-dark` | `exp-slate` | `exp-light` | `exp-classic`). */
export function parseApUiCookie(raw: string | undefined): ExperimentalUiMode {
  if (raw === 'exp-dark') return 'aperture';
  if (raw === 'exp-slate') return 'slate';
  if (raw === 'exp-light') return 'light';
  if (raw === 'exp-classic') return 'classic';
  return 'off';
}

/** Cookie value written for a given mode (`off` clears the cookie). */
export function experimentalUiModeToCookieValue(mode: ExperimentalUiMode): string | null {
  switch (mode) {
    case 'aperture':
      return 'exp-dark';
    case 'slate':
      return 'exp-slate';
    case 'light':
      return 'exp-light';
    case 'classic':
      return 'exp-classic';
    case 'off':
      return null;
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export type ExperimentalHtmlAttributes = {
  'data-ui'?: 'experimental';
  'data-theme'?: 'dark' | 'light';
  'data-variant'?: 'aperture' | 'slate' | 'light' | 'classic';
};

/** `data-ui` / `data-theme` / `data-variant` for `<html>` when SSR knows the cookie. */
export function experimentalUiHtmlAttributes(mode: ExperimentalUiMode): ExperimentalHtmlAttributes {
  if (mode === 'off') return {};
  const dataTheme = mode === 'light' ? 'light' : 'dark';
  return { 'data-ui': 'experimental', 'data-theme': dataTheme, 'data-variant': mode };
}

/** Read the mode from the live `<html>` attributes (client-only). */
export function readExperimentalUiFromHtml(): ExperimentalUiMode {
  if (typeof document === 'undefined') return 'off';
  const root = document.documentElement;
  if (root.getAttribute('data-ui') !== 'experimental') return 'off';
  const variant = root.getAttribute('data-variant');
  if (variant === 'aperture' || variant === 'slate' || variant === 'classic') return variant;
  const theme = root.getAttribute('data-theme');
  if (theme === 'light') return 'light';
  if (theme === 'dark') return 'aperture';
  return 'off';
}

function secureCookieSuffix(): string {
  return typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
}

/** Persist the preference and mirror it on `<html>` without a reload. */
export function writeExperimentalUi(mode: ExperimentalUiMode): void {
  const root = document.documentElement;
  const suffix = secureCookieSuffix();

  if (mode === 'off') {
    root.removeAttribute('data-ui');
    root.removeAttribute('data-theme');
    root.removeAttribute('data-variant');
    document.cookie = `${AP_UI_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${suffix}`;
    return;
  }

  const attrs = experimentalUiHtmlAttributes(mode);
  root.setAttribute('data-ui', 'experimental');
  root.setAttribute('data-theme', attrs['data-theme']!);
  root.setAttribute('data-variant', attrs['data-variant']!);
  const value = experimentalUiModeToCookieValue(mode);
  if (value) {
    document.cookie = `${AP_UI_COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax${suffix}`;
  }
}

export function isExperimentalUiActive(mode: ExperimentalUiMode): boolean {
  return mode !== 'off';
}

/** Map paint variant passed to `MapStyleOptions` (never `off`). */
export function experimentalMapStyleVariant(mode: ExperimentalUiMode): import('@/components/map/styling').MapStyleVariant {
  if (mode === 'off') return 'aperture';
  return mode;
}
