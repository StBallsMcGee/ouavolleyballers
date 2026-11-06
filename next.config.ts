import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // `pg` is only used in server code (sync jobs, admin import); keep it out of the bundle.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
