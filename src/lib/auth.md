## auth.ts

**Purpose:** Auth.js v5 setup — stateless JWT sessions backed by the EVE SSO provider, with login persistence and access-token rotation wired into the `jwt` callback.
**File:** `src/lib/auth.ts`

---

### handlers / auth / signIn / signOut
The standard Auth.js v5 exports. `handlers` is mounted by the `[...nextauth]` route; `auth` reads the session in server components/actions. (There is no `unstable_update` — active-character switching is gone, so nothing re-issues the JWT out of band.)

### Config
- `providers: [eveProvider()]`, `session.strategy: 'jwt'` (no DB session store).
- **`cookies` block:** the `sessionToken`, `callbackUrl`, and `csrfToken` cookies all carry `AUTH_COOKIE_OPTIONS` from `@/lib/cookies` (`httpOnly`, `sameSite: 'lax'`, `secure` in production, `path: '/'`). Cookie names stay at the Auth.js defaults (`authjs.session-token`, etc.).
- **`pages: { error: '/access-denied' }`** — a denied sign-in (the `signIn` callback returning false) redirects the browser to `/access-denied?error=AccessDenied` instead of the raw Auth.js error endpoint.
- **`signIn` callback (the login gate):** runs *before* `jwt`, so a denial issues no session/JWT and the `jwt` branch (`persistLogin`/`syncCharacterAuthz`) never runs — no `ap_character` row is created for a rejected sign-in. Reads the character id from the verified profile, then resolves corp/alliance via the token-less `fetchAffiliations([characterId])` (`@/lib/esi/affiliation`, ~1h cache — so a freshly-joined member gates in within the hour rather than waiting out the ~24h public-profile cache); on ESI failure it degrades to character-level checks (corp/alliance left `null`, logged as a warning, never fails open). Defers the decision to `isLoginAllowed` (`@/lib/auth/loginGate.ts`), which enforces `access_mode`, the owner/allowlist checks, and the unconfigured-instance bootstrap.
- **`jwt` callback:**
  - On initial sign-in (`account` + `profile` present): reads the signed `ap_link` cookie (`link-cookie.ts`) to resolve an "Add character" link target, calls `persistLogin(..., linkUserId)`, clears the cookie. When that character already had its own standalone account, `persistLogin` **re-homes** it onto the linking account (issue #116) and the session correctly lands on the linking account's main below. **Land on main:** the token's `characterId` is then set to `resolveMainCharacter(userId, authenticatedCharacterId)`, **not** the character that SSO'd in. `accessTokenExpiresAt` is taken from the main character's own DB expiry (or the freshly-exchanged expiry when the main *is* the authenticated character). `userId` is also carried. Because the "Add character" flow goes through this same branch, adding an alt returns the session to the existing main. Also fires `syncCharacterAuthz(authenticatedCharacterId)` to reconcile `authz_level`, affiliations, and corp-title role memberships against ESI for the character that just authenticated, then `seedTrackingForGainedAccess(authenticatedCharacterId)` so a re-joining pilot or a freshly-added alt lands **already tracked** on every already-seeded map it can now view (covers the case where a corp re-join is immediately followed by login — the cron sweep would otherwise miss it, since this `syncCharacterAuthz` already freshened the affiliation cache) — both best-effort, ESI failure is logged but does not block login. Stamps `gateCheckedAt` so the re-gate (below) doesn't immediately re-fire.
  - On later calls: if within `SSO_TOKEN_REFRESH_BUFFER_S` of expiry, calls `refreshAccessToken` (which persists the rotated refresh token before returning) and refreshes the expiry hint from the DB. Refresh failures are swallowed so a revoked token degrades to logged-out rather than throwing.
  - **Session re-gate:** at most once per `LOGIN_REGATE_INTERVAL_S` (throttled via `gateCheckedAt`), re-evaluates login eligibility for the already-issued session. Reads the character's `status` + cached `corporationId`/`allianceId` from `ap_character` (kept fresh by the `character-cleanup` affiliation sweep — **no ESI on the hot path**) and re-runs `isLoginAllowed`. If the row is missing, the status isn't `active`, or the gate now denies, the callback **returns `null`** to invalidate the session (the next navigation lands on `/access-denied`). This is what locks a pilot out of a restricted deployment after they leave the owning corp/alliance.
- **`session` callback:** exposes `characterId` and `userId` only — never raw ESI tokens.

### persistLogin
Lives in its own module — see `src/lib/auth/persistLogin.md`. Extracted so it is importable (by tests) without pulling in the NextAuth construction here. The `jwt` callback calls it on initial sign-in; it resolves/​re-homes the owning `ap_user` and upserts the `ap_character` row, returning the resolved `userId`.

### resolveMainCharacter(userId, fallbackCharacterId): Promise<bigint>
Internal. Returns the character the session should land on. Reads `ap_user.main_character_id`; if unset, bootstraps it to `fallbackCharacterId` (the just-authenticated character) via a guarded `UPDATE ... WHERE main_character_id IS NULL` and returns it. If set, validates the stored main is still an `active` character on the account and returns it, otherwise falls back to `fallbackCharacterId`. Implemented inline rather than importing `@/lib/session` to avoid an import cycle (`session.ts` imports `auth` from here).

### Module augmentation
Adds `characterId`/`userId` to `Session` and `characterId`/`userId`/`accessTokenExpiresAt`/`gateCheckedAt` to the `JWT`.

---

Notes:
- Corp/alliance ids are refreshed by `syncCharacterAuthz` on every sign-in (and by the `character-cleanup` affiliation sweep thereafter), resolved from the ~1h-cached affiliation endpoint via `fetchAffiliations`.
- The session re-gate makes login eligibility enforced continuously (throttled), not just at sign-in.
- Node runtime only (crypto + pg).
