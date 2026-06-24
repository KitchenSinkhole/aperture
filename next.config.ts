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
  serverExternalPackages: ['pg', 'graphile-worker'],
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
