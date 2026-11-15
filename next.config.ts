import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Allow the Space-Z preview gateway origins to load /_next/* dev assets
  // cross-origin (Next 16 blocks unlisted origins in dev; production is
  // unaffected — this only shapes `next dev` behavior).
  allowedDevOrigins: ["space-z.ai", "*.space-z.ai"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
