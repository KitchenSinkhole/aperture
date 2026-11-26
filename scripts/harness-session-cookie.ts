/**
 * Harness-only: mint an Auth.js session JWT for the pd demo DB (character 92000101).
 * Prints a Playwright `storageState` JSON path or raw cookie for :3005 captures.
 *
 * Usage (defaults match Cloud Agent harness env):
 *   AUTH_SECRET=test-auth-secret-for-pd-demo pnpm exec tsx scripts/harness-session-cookie.ts
 *   pnpm exec tsx scripts/harness-session-cookie.ts --write /tmp/aperture-harness-auth.json
 */
import { writeFileSync } from 'node:fs';
import { encode } from 'next-auth/jwt';

const COOKIE_NAME = 'authjs.session-token';
const DEFAULT_CHARACTER = '92000101';
const DEFAULT_USER = '2';

async function main() {
  const args = process.argv.slice(2);
  const writeIdx = args.indexOf('--write');
  const outPath = writeIdx >= 0 ? args[writeIdx + 1] : null;

  const secret = process.env.AUTH_SECRET ?? 'test-auth-secret-for-pd-demo';
  const baseUrl = process.env.AUTH_URL ?? 'http://127.0.0.1:3005';

  const token = await encode({
    token: { characterId: DEFAULT_CHARACTER, userId: DEFAULT_USER },
    secret,
    salt: COOKIE_NAME,
  });

  const storageState = {
    cookies: [
      {
        name: COOKIE_NAME,
        value: token,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
      {
        name: 'ap_ui',
        value: 'panels',
        domain: '127.0.0.1',
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };

  if (outPath) {
    writeFileSync(outPath, JSON.stringify(storageState, null, 2));
    console.log(`Wrote Playwright storageState → ${outPath} (base ${baseUrl})`);
  } else {
    console.log(JSON.stringify({ cookie: `${COOKIE_NAME}=${token}`, storageState }, null, 2));
  }
}

void main();
