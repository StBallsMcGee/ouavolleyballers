import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `pg` is only used in server code (sync jobs, admin import); keep it out of the bundle.
  serverExternalPackages: ["pg"],
  experimental: {
    // Going back to a screen you saw in the last 30 seconds shows it instantly instead of
    // reloading it. Saving a lineup, trade, etc. still refreshes the affected screens at once.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
