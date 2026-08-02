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
    // The deployment's own origin. Auth.js reads this straight from
    // `process.env`; it is declared here so `metadataBase` can resolve the
    // absolute URLs a share link's unfurl card needs.
    AUTH_URL: z.string().default(''),
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
    // Opt-in `/api/metrics` Prometheus endpoint. Off by default so a self-hoster
    // doesn't unknowingly expose internals; the public deployment turns it on and
    // sets a token. With it disabled the route 404s.
    METRICS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // Bearer/`?token=` secret guarding `/api/metrics` while enabled. An empty
    // token admits nothing (the route 401s), so enabling without a token is a
    // closed door rather than an open one.
    METRICS_TOKEN: z.string().default(''),
    // Opt-in `/api/integrations/*` group (machine-to-machine, token-authenticated
    // data feeds — see docs/spec/integration-activity-stats.md). Off by default;
    // with it disabled every route in the group 404s. Per-token auth (not a
    // single shared secret) lives in `ap_integration_token`.
    INTEGRATIONS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // Phase 6 instance alerting. Two Discord webhooks, both optional: the alert
    // loop no-ops when both are empty. `ALERT_WEBHOOK_URL` is the verbose
    // operator channel (PII-scrubbed detail); `STATUS_WEBHOOK_URL` is the terse,
    // user-facing public channel. Plain strings (not `.url()`) so an empty
    // default stays valid, matching `METRICS_TOKEN`.
    ALERT_WEBHOOK_URL: z.string().default(''),
    STATUS_WEBHOOK_URL: z.string().default(''),
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
