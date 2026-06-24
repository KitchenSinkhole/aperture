/**
 * Client-safe mirrors of the `ap/*` pgEnum value lists. Importing the real
 * `pgEnum` from `@/db/schema` into a `'use client'` module would pull
 * `drizzle-orm/pg-core` into the browser bundle for no reason — this file is the
 * single source of truth on the client.
 *
 * Keep these arrays in sync with `src/db/schema/ap/enums.ts`. A drift would
 * surface as a `system_status` (or similar) value the inspector can't render;
 * the server-side Zod schemas in `protocol.ts` still gate the wire.
 */

export const SYSTEM_STATUSES = [
  'unknown',
  'friendly',
  'occupied',
  'hostile',
  'empty',
  'unscanned',
] as const;
export type SystemStatus = (typeof SYSTEM_STATUSES)[number];

export const CONNECTION_SCOPES = ['wh', 'stargate', 'jumpbridge', 'abyssal'] as const;
export type ConnectionScope = (typeof CONNECTION_SCOPES)[number];

export const WH_MASSES = ['fresh', 'reduced', 'critical'] as const;
export type WhMass = (typeof WH_MASSES)[number];

export const WH_JUMP_MASSES = ['s', 'm', 'l', 'xl'] as const;
export type WhJumpMass = (typeof WH_JUMP_MASSES)[number];

export const EOL_STAGES = ['none', 'eol', 'critical'] as const;
export type EolStage = (typeof EOL_STAGES)[number];

export const NOTE_SEVERITIES = ['neutral', 'green', 'yellow', 'red'] as const;
export type NoteSeverity = (typeof NOTE_SEVERITIES)[number];

/** Human labels for the severity selector in the note inspector / context menu. */
export const NOTE_SEVERITY_LABELS: Record<NoteSeverity, string> = {
  neutral: 'Neutral',
  green: 'Green',
  yellow: 'Yellow',
  red: 'Red',
};

/** Human labels for the EOL-stage selector in the connection inspector. */
export const EOL_STAGE_LABELS: Record<EolStage, string> = {
  none: 'None',
  eol: 'EOL (~4h)',
  critical: 'Critical (~1h)',
};

/** Human labels for the wormhole mass selector in the connection inspector */
export const WH_MASS_LABELS: Record<WhMass, string> = {
  fresh: 'Fresh (>50%)',
  reduced: 'Reduced (<50%)',
  critical: 'Critical (<10%)',
};