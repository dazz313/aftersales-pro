import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Sertakan Prisma client + engine di standalone build (wajib untuk versi desktop)
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.prisma/**", "./node_modules/@prisma/**"],
  },
};

export default nextConfig;
