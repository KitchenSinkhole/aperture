import 'server-only';

import { cookies } from 'next/headers';

import { AP_UI_COOKIE, parseApUiCookie, type ExperimentalUiMode } from '@/lib/experimentalUi';

/** Read the experimental UI mode from the request cookies (server components / layout). */
export async function getExperimentalUiFromCookies(): Promise<ExperimentalUiMode> {
  const jar = await cookies();
  return parseApUiCookie(jar.get(AP_UI_COOKIE)?.value);
}
