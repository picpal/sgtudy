import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/securityHeaders";

const nextConfig: NextConfig = {
  // 의견 보내기(0044)의 「앱 버전」 — Vercel 빌드 커밋 앞 7자. 로컬·없으면 빈 값(화면은 dev 로 보낸다)
  env: { NEXT_PUBLIC_APP_COMMIT: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) },
  // nosniff + CSP img-src(서명 URL 의 Supabase 출처만) — md-images 스펙 D17
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env.NEXT_PUBLIC_SUPABASE_URL) }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
