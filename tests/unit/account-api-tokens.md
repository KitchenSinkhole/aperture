## account-api-tokens.test.tsx

**Purpose:** Component tests for Account Settings' API tokens section (`src/components/account/AccountApiTokens.tsx`) with its Server Actions mocked.
**File:** `tests/unit/account-api-tokens.test.tsx`

Stubs the Base UI-backed `Dialog` and `Button` primitives so they render inline in jsdom; a dialog's content renders only while open, and `DialogTrigger` is a plain "Open" button that opens it.

### Covers
- The list names each token's map and its computed status, including Owner lost access, API off on this map and Map deleted; an empty list reads "No tokens.".
- The block banner shows the reason and end time for a timed block, and "until an admin lifts it" for an indefinite one.
- Revoking calls `revokeMapApiToken` with the token's id and reloads the list.
