## scrub.ts

**Purpose:** PII scrubbing for anything bound for `ap_error_log.context` — a denylist filter that strips names/IPs/emails/secrets while keeping ids.
**File:** `src/lib/log/scrub.ts`

---

### scrubContext(raw: unknown): Record<string, unknown> | undefined
Deep-scrubs a context value for persistence by the logger ([[logger]]).

**Behaviour:**
- Recursively walks objects/arrays; any key whose normalized form (lowercased, separators stripped) is in the denylist (`characterName`, `name`, `ip`, `xForwardedFor`, `email`, `userAgent`, `token`, `password`, `authorization`, `cookie`, …) has its value replaced with `'[redacted]'`. A character *id* is **not** denylisted — ids are allowed.
- An `Error` value (top-level or nested) is flattened to `{ name, message, stack }` (a stack is code paths, not PII).
- Recursion is depth-capped (`MAX_DEPTH=6`); deeper levels are dropped (guards against cyclic/pathological context).
- Returns `undefined` for `null`/`undefined`/empty-object input so the caller stores SQL `NULL` rather than `{}`.

**Notes:** Defense-in-depth — call sites are expected to pass ids, but this guarantees a careless `context` can't leak a name into the table. No `import 'server-only'` (part of the runner-reachable logger chain); pure data transform, no I/O.
