import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "sharp", "@aws-sdk/client-s3"],
  poweredByHeader: false,
};

export default nextConfig;
