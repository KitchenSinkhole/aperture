import type { NextConfig } from 'next';

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
