## user-api-route-coverage.test.ts

**Purpose:** Static scan guarding the `/api/v1/*` user API surface: every route file exports its handlers through `userApiRoute` (`src/lib/userApi/handler.ts`), and nothing on the API path reads a cookie or a session.
**File:** `tests/unit/user-api-route-coverage.test.ts`

DB-free; reads source files only.

### Covers
- Every `route.ts` under `src/app/api/v1` imports `userApiRoute` and builds `const route = userApiRoute(...)`.
- Its only exports are segment config (`runtime`, `dynamic`) and `export const <METHOD> = route.<METHOD>;`, including `GET`; a hand-written handler, a re-export or any other export fails.
- No route file and not `handler.ts` mentions `cookies`, `next/headers`, `getSession` or `@/lib/auth`.
