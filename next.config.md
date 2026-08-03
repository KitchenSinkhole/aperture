## next.config.ts

**Purpose:** Next.js build/runtime configuration — typed routes, server-external native packages, Turbopack root, and the app-wide Content-Security-Policy header.
**File:** `next.config.ts`

---

### nextConfig (default export)

- `typedRoutes: true` — typed `Route` link checking.
- `serverExternalPackages: ['pg', 'graphile-worker', 'pino']` — keep these native/Node-only packages out of the server bundle. `pino` is external so its runtime `require` of `sonic-boom`/thread-stream isn't mangled by the bundler (the structured logger, `src/lib/log/logger.ts`).
- `turbopack.root` — pins the workspace root to this directory.
- `allowedDevOrigins` — private LAN ranges (`192.168.*.*`, `10.*.*.*`, `172.16.*.*`). Dev-only: Next blocks cross-origin requests to `/_next` and `/__nextjs` resources, and a browser sends `Origin` on the HMR websocket handshake though not on `<script src>` loads, so a device reaching the dev server by LAN address otherwise downloads every chunk but has its HMR socket dropped and reload-loops without hydrating. `localhost` is always allowed. The dev server reads this at boot, so a change needs a restart (`tsx watch` restarts on `server.ts`, not on this file).
- `headers()` — emits one `Content-Security-Policy` header on every route (`source: '/:path*'`).

### Content-Security-Policy
Only the `img-src` directive is set: `'self' data: blob: https://images.evetech.net`. No `default-src`, so **only image loading is constrained** — scripts, styles, fonts, and `connect` are untouched (no nonce plumbing needed). CCP's image server (`images.evetech.net`) is the sole legitimate remote image origin (character/corp/alliance/ship art via `ccpImageUrl`); `data:`/`blob:` cover inline and object-URL images. This blocks arbitrary remote images embedded in user-authored markdown — notably map-note content (`NoteContent`) — at the browser level. If a new feature needs images from another origin, add it to the `imgSrc` allowlist.
