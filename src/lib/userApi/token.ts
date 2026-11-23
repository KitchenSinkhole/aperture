// No `import 'server-only'`: the log scrubber imports this module, and the
// logger chain is loaded by the job runner under bare tsx, where the
// `server-only` shim does not resolve.
import { createHash, randomBytes } from 'node:crypto';

/**
 * Format of a per-map user API bearer token: `apu_` plus `randomBytes(32)` as
 * base64url. The fixed prefix and length let the request pipeline reject
 * garbage without a database read, and let secret scanners and the log
 * scrubber recognise a token.
 */
export const USER_API_TOKEN_PREFIX = 'apu_';

const RANDOM_BYTES = 32;
// base64url of 32 bytes, unpadded.
const RANDOM_LENGTH = 43;
const DISPLAY_PREFIX_LENGTH = 6;

const TOKEN_BODY = `${USER_API_TOKEN_PREFIX}[A-Za-z0-9_-]{${RANDOM_LENGTH}}`;
const WHOLE_TOKEN = new RegExp(`^${TOKEN_BODY}$`);
// Open-ended so a token with characters glued to its end is redacted whole.
const EMBEDDED_TOKEN = new RegExp(`${USER_API_TOKEN_PREFIX}[A-Za-z0-9_-]{${RANDOM_LENGTH},}`, 'g');

export interface GeneratedUserApiToken {
  /** The raw token. Returned to the creator once, never persisted. */
  token: string;
  /** sha256 hex digest, the only form stored. */
  hash: string;
  /** First characters of the random part, for telling tokens apart in lists. */
  prefix: string;
}

export function generateUserApiToken(): GeneratedUserApiToken {
  const random = randomBytes(RANDOM_BYTES).toString('base64url');
  const token = `${USER_API_TOKEN_PREFIX}${random}`;
  return {
    token,
    hash: hashUserApiToken(token),
    prefix: random.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}

export function hashUserApiToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * The raw token carried by an `Authorization` header value, or `null` when the
 * header is absent, uses another scheme, or does not hold a well-formed token.
 * The scheme name is case-insensitive (RFC 7235). There is no query-string
 * fallback.
 */
export function parseUserApiBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^bearer +(\S+) *$/i.exec(header);
  if (!match) return null;
  const raw = match[1]!;
  return WHOLE_TOKEN.test(raw) ? raw : null;
}

/** `text` with every embedded well-formed token replaced by `apu_[redacted]`. */
export function redactUserApiTokens(text: string): string {
  return text.includes(USER_API_TOKEN_PREFIX)
    ? text.replace(EMBEDDED_TOKEN, `${USER_API_TOKEN_PREFIX}[redacted]`)
    : text;
}
