import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next.js 16: middleware.ts 는 deprecated, proxy.ts 가 같은 역할(node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md)
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // 정적 자원·이미지·파비콘 제외, 나머지 전부(세션 갱신은 모든 페이지에서 필요)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
