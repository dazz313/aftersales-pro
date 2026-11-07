import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdfjs-dist (ekstrak teks PDF faktur surat jalan) tidak di-bundle —
  // legacy build punya require dinamis (canvas/worker) yang pecah bila
  // digabung; dipakai sebagai require runtime dari node_modules standar.
  serverExternalPackages: ["pdfjs-dist"],
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
        source: "/",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, max-age=0" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          // HSTS: paksa HTTPS pada kunjungan berikutnya. Diabaikan browser saat
          // diakses via HTTP (mis. Electron http://127.0.0.1), jadi aman untuk
          // dev/desktop. Tanpa includeSubDomains agar tidak berdampak ke
          // subdomain lain. Deployment di belakang Cloudflare juga sebaiknya
          // menyalakan HSTS di sisi edge (SSL/TLS → Edge Certificates).
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          // Kamera dibutuhkan untuk scan barcode; mic & geolocation dimatikan
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // Sertakan Prisma client + engine di standalone build (wajib untuk versi desktop)
  outputFileTracingIncludes: {
    "/*": ["./node_modules/.prisma/**", "./node_modules/@prisma/**", "./node_modules/pdfjs-dist/**", "./node_modules/next/dist/server/**"],
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
