// No `import 'server-only'`: this module is part of the structured-logger chain
// ([[logger]]), reached by background-job code the custom `server.ts` loads via
// tsx outside Next's bundler where the `server-only` shim doesn't resolve. Pure
// data transform — no DB, no I/O.

/**
 * PII scrubbing for anything bound for `ap_error_log.context`. The stored
 * context must carry no character names / IPs / emails / secrets (a character
 * *id* is allowed — it is not in this denylist). This is defense-in-depth: call
 * sites are expected to pass ids, but a careless `context` object can't leak a
 * name past this filter.
 */

// Match keys case-insensitively, ignoring separators (`character_name`,
// `characterName`, `x-forwarded-for` all normalize the same).
const DENY_KEYS = new Set([
  'charactername',
  'name',
  'username',
  'user',
  'displayname',
  'pilot',
  'ip',
  'ipaddress',
  'xforwardedfor',
  'forwardedfor',
  'remoteaddr',
  'email',
  'mail',
  'useragent',
  'ua',
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'secret',
  'authorization',
  'cookie',
]);

const REDACTED = '[redacted]';
// Cap recursion so a self-referential or pathologically deep context can't hang
// the logger; deeper levels are dropped.
const MAX_DEPTH = 6;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scrubValue(value: unknown, depth: number): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = DENY_KEYS.has(normalizeKey(k)) ? REDACTED : scrubValue(v, depth + 1);
  }
  return out;
}

/**
 * Scrub a context object for persistence. Returns `undefined` for empty/absent
 * input so the caller stores SQL `NULL` rather than `{}`. An `Error` value (or a
 * nested one) is flattened to `{ name, message, stack }` — a stack is code paths,
 * not PII.
 */
export function scrubContext(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || raw === undefined) return undefined;
  const scrubbed = scrubValue(raw, 0);
  if (scrubbed === null || typeof scrubbed !== 'object' || Array.isArray(scrubbed)) {
    return { value: scrubbed };
  }
  const obj = scrubbed as Record<string, unknown>;
  return Object.keys(obj).length > 0 ? obj : undefined;
}
