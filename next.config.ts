import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Header keamanan produksi. SENGAJA tanpa frame-ancestors/X-Frame-Options
  // karena aplikasi didukung berjalan ter-embed dalam iframe preview.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          // Kamera dibutuhkan untuk scan barcode; mic & geolocation dimatikan
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // Sertakan Prisma client + engine di standalone build (wajib untuk versi desktop)
  outputFileTracingIncludes: {
    "/*": ["./node_modules/.prisma/**", "./node_modules/@prisma/**"],
  },
  // Jangan salin folder data repo ke dalam output standalone:
  // db/ (custom.db + backup + snapshot), upload/, download/ dan .cache/
  // (data bahasa Tesseract) — bukan bagian dari bundle server, dan ikut
  // ter-copy ke .next/standalone membuat file runtime ditulis ke folder build.
  outputFileTracingExcludes: {
    "**": [
      "./src/**",
      "./scripts/**",
      "./tests/**",
      "./mcp/**",
      "./mini-services/**",
      "./electron/**",
      "./examples/**",
      "./db/**",
      "./upload/**",
      "./download/**",
      "./logs/**",
      "./.cache/**",
    ],
  },
};

export default nextConfig;
