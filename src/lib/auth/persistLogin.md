## persistLogin.ts

**Purpose:** Upsert the user + character on initial EVE SSO sign-in, store the encrypted ESI tokens, and resolve (or re-home) the owning `ap_user` account.
**File:** `src/lib/auth/persistLogin.ts`

Lives in its own module rather than `@/lib/auth` so it is importable without pulling in the NextAuth construction, which only resolves inside the Next bundler (this is the test seam).

---

### persistLogin(profile, tokens, linkUserId?): Promise<number>
Runs in a single `db.transaction` so the re-home + old-account cleanup are atomic. Resolves the owning `ap_user`:

- An **unseen** character with a valid `linkUserId` (the "Add character" flow) is attached to that account; without a link a fresh `ap_user` is minted.
- An **already-seen** character whose `linkUserId` differs from its current account is **re-homed** onto the linking account (issue #116 — the fix for "adding an alt that already has its own account logs you into that account instead"). If the move empties the old account it is **deleted** (absorbed — FK cascades clear its `ap_map_tracking_seed` / `ap_route_destination` rows; `ap_map_event.character_id` is `ON DELETE SET NULL` and the moved character's events stay on the moved character, so audit/stats history follows it and reattributes to the linking account's main on the next query-time join). If the old account keeps other characters but its `main_character_id` was the moved character, the main is repointed to a remaining character (lowest id) so its main/stats stay valid without a re-login. Authorized by the fresh SSO proof of control over the character plus the `signIn` login gate.
- Otherwise (no link, or link to its own account) the character keeps its `user_id`.

Then upserts the `ap_character` row (encrypted access/refresh tokens, scopes, owner hash, name).

**Parameters:**
- `profile` — the verified EVE SSO `EveProfile` (character id, name, owner hash, scopes).
- `tokens` — freshly-exchanged `accessToken` / `refreshToken` / `expiresAt` (epoch seconds).
- `linkUserId` — the "Add character" link target from the signed `ap_link` cookie; `null`/absent ⇒ fresh-account behavior.

**Returns:** the resolved `userId` the session should belong to.
