import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== 'production'

// Mesh/preview bytes come from Vercel Blob; three.js + textures may use blob:/data:.
const BLOB = 'https://*.public.blob.vercel-storage.com'

const csp = [
  `default-src 'self'`,
  // Dev/HMR needs unsafe-eval (React Refresh); prod build does not. No client WASM
  // (manifold runs server-side), so no wasm-unsafe-eval required.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${BLOB}`,
  `font-src 'self' data:`,
  `connect-src 'self' ${BLOB}${isDev ? ' ws:' : ''}`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `frame-ancestors 'none'`,
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

const nextConfig: NextConfig = {
  // Move the dev indicator out of the bottom-left where it covers the chat's
  // attach button. Set to false if you don't need it at all.
  devIndicators: {
    position: 'bottom-right',
  },
  // Don't bundle these — they're CommonJS libs that rely on `require()`
  // returning a class directly (e.g. potrace does `target instanceof Jimp`).
  // Turbopack's CJS interop wraps the export in `{ default }`, which makes
  // `Jimp` a non-callable object and breaks `instanceof`.
  serverExternalPackages: ['potrace', 'jimp', 'sharp', '@jscad/modeling', 'manifold-3d'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
};

export default nextConfig;
