import { z } from 'zod';
import { version } from '../../package.json';

/**
 * System-boundary validation for `process.env`. Fails fast at import time.
 *
 * The SSO / crypto secrets are *required in production* (a deployment that
 * can authenticate must have them) but stay optional in dev/test so a fresh
 * clone can `pnpm dev`, run migrations, and run the test suite without a
 * `.env.local`. There is no dotenv loader in this repo — `next dev` injects
 * `.env.local`, while standalone `tsx` scripts inherit the shell env — so
 * hard-requiring these unconditionally would break `db:migrate` / Vitest.
 */
const schema = z
  .object({
    DATABASE_URL: z
      .string()
      .min(1)
      .default('postgres://postgres:postgres@localhost:5432/aperture'),
    AUTH_SECRET: z.string().default(''),
    AUTH_EVE_CLIENT_ID: z.string().default(''),
    AUTH_EVE_CLIENT_SECRET: z.string().default(''),
    AUTH_EVE_SSO_BASE: z.string().url().default('https://login.eveonline.com'),
    ESI_BASE_URL: z.string().url().default('https://esi.evetech.net'),
    EVE_USER_AGENT: z.string().default(`Aperture/${version} (contact@example.com)`),
    ESI_TOKEN_ENC_KEY: z.string().default(''),
    SETUP_PASSWORD: z.string().default(''),
    // Master switch for the server-side zKillboard live feed
    // (`src/lib/integrations/zkbFeed.ts`). Default on; set `false` to disable
    // the outbound feed (CI, air-gapped dev, or when zKB is degraded).
    ZKB_FEED_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    // URL or absolute path served from /public. Used in <head> icon metadata.
    // Operators can point this at a custom hosted icon or drop a file in public/.
    FAVICON_URL: z.string().default('/favicon.png'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV !== 'production') return;
    for (const key of ['AUTH_SECRET', 'AUTH_EVE_CLIENT_ID', 'AUTH_EVE_CLIENT_SECRET', 'ESI_TOKEN_ENC_KEY', 'SETUP_PASSWORD'] as const) {
      if (!v[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required in production` });
    }
  });

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
