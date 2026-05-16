import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Move the dev indicator out of the bottom-left where it covers the chat's
  // attach button. Set to false if you don't need it at all.
  devIndicators: {
    position: 'bottom-right',
  },
};

export default nextConfig;
