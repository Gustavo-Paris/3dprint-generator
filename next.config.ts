import type { NextConfig } from "next";

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
  serverExternalPackages: ['potrace', 'jimp', 'sharp', '@jscad/modeling'],
};

export default nextConfig;
