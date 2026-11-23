# Vitest `act` failure evidence (PASS 3, 2026-11-12)

Environment: Cloud agent VM, Node v22.23.4, `react@19.2.6`, default `vitest.config.ts` (no `NODE_ENV`).

| Branch | Failed tests | Failed files | Notes |
|--------|--------------|--------------|-------|
| `upstream/dev` | 126 | 22 | `TypeError: act is not a function` |
| `experimental-ui-qol` | 126 | 22 | same |
| `experimental-ui-panels` @ `1cecbc6` | 129 | 23 | +3 vs dev (layout version + new unit tests) |

**Cause:** Vitest/Vite resolves React's production entry where `React.act` is undefined; tests call `act()` from `react` or via `react-dom/test-utils` (which delegates to `React.act`).

**Fix (env-only):** `test.env.NODE_ENV = 'test'` in `vitest.config.ts` — `act` is present on the React build used in test mode.

**Additional env (pre-existing on dev, same VM):** Several `node:fs` suites failed under default `environment: 'jsdom'` with `No such built-in module: node:` — fixed with `// @vitest-environment node` on those files (not changing application code).
