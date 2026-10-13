import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import { unstable_rethrow } from "next/navigation";
import { getMe, getToday } from "@/lib/api/me.server";
import type { Me } from "@/lib/api/types";
import { kstToday } from "@/lib/kst";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import "./globals.css";

const plex = IBM_Plex_Sans_KR({
  variable: "--font-plex",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "슥터디",
  description: "함께 목표를 세우고, 누가 어디까지 왔는지 한눈에 확인하세요.",
};

/** 로그인 안 했으면 null. me_get 은 온보딩 전에도 허용(03-api §1). 실패해도 사이트 전체를 죽이지 않는다 → 익명 취급 */
async function loadMe(): Promise<Me | null> {
  try {
    return await getMe();
  } catch (e) {
    unstable_rethrow(e); // cookies() 동적 렌더 신호는 삼키지 않는다(/_not-found 정적 프리렌더 방지)
    console.error("[layout] me_get failed — rendering as anonymous", e);
    return null;
  }
}

/** meta_get 실패(DB 다운·네트워크) 시 전 페이지 500 대신 KST 오늘로 폴백(S13). 화면별 응답 today 가 다시 덮어쓴다 */
async function loadToday(): Promise<string> {
  try {
    return await getToday();
  } catch (e) {
    unstable_rethrow(e);
    console.error("[layout] meta_get failed — falling back to Intl Asia/Seoul today", e);
    return kstToday();
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [today, me] = await Promise.all([loadToday(), loadMe()]);
  return (
    <html lang="ko" className={`${plex.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <MeProvider me={me}>
          <TodayProvider today={today}>{children}</TodayProvider>
        </MeProvider>
      </body>
    </html>
  );
}
