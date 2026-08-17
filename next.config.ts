import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// Deployment-local bookmark scheme override slot: `#bookmark-local` resolves
// to a deployment's untracked local.ts when present, and to the tracked empty
// slot (localNone.ts) otherwise, so a clone with no override still builds.
const bookmarkLocalPath = existsSync(
  path.join(__dirname, 'src/lib/bookmarking/local.ts'),
)
  ? './src/lib/bookmarking/local.ts'
  : './src/lib/bookmarking/localNone.ts';

// Restrict where images may load from. The only legitimate remote image origin
// is CCP's image server (character/corp/alliance/ship art); everything else is
// same-origin or inline. This blocks arbitrary remote images embedded in
// user-authored markdown (e.g. map notes) without affecting scripts or styles
// (no default-src, so only img-src is constrained). `data:`/`blob:` cover
// inline and object-URL images.
const imgSrc = "img-src 'self' data: blob: https://images.evetech.net";

const nextConfig: NextConfig = {
  typedRoutes: true,
  // Dev only. Next blocks cross-origin dev requests, and a browser sends an
  // `Origin` header on the HMR websocket handshake but not on `<script src>`
  // loads — so a device hitting the dev server by LAN address downloads every
  // chunk, has its HMR socket dropped, and reload-loops without ever
  // hydrating. Private ranges cover testing from a phone or tablet.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.16.*.*'],
  serverExternalPackages: ['pg', 'graphile-worker', 'pino'],
  turbopack: {
    root: __dirname,
    resolveAlias: {
      '#bookmark-local': bookmarkLocalPath,
    },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: imgSrc }],
      },
    ];
  },
};

export default nextConfig;
