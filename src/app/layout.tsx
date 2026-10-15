import type { Metadata } from "next";
import { IBM_Plex_Sans_KR } from "next/font/google";
import { unstable_rethrow } from "next/navigation";
import { getAuthClaims, getMe, getMyStudies, getToday } from "@/lib/api/me.server";
import { myStudyHrefOf } from "@/lib/api/my-study";
import type { Me } from "@/lib/api/types";
import { kstToday } from "@/lib/kst";
import { routes } from "@/lib/routes";
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

/**
 * 헤더 "내 스터디" 링크 주소. /my-study → /my-study/<slug> 리다이렉트로 RSC 왕복이 두 번 이어지던 것을 없앤다.
 * me_get 과 병렬이라 레이아웃 렌더(하드 로드·refresh)에 직렬 지연을 더하지 않고, 소프트 이동에서는 레이아웃이 다시 돌지 않는다.
 * /my-study 페이지와 같은 요청 메모(getMyStudies)를 써 그 화면에선 추가 호출도 없다.
 * 비로그인·실패·스터디 없음은 /my-study — 그 페이지가 지금처럼 로그인/빈 화면/리다이렉트를 맡는다(낡은 값도 거기서 바로잡힌다).
 */
async function loadMyStudyHref(): Promise<string> {
  try {
    if (!(await getAuthClaims())) return routes.myStudy();
    return myStudyHrefOf(await getMyStudies());
  } catch (e) {
    unstable_rethrow(e);
    console.error("[layout] me_studies failed — header links to /my-study", e);
    return routes.myStudy();
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
  const [today, me, myStudyHref] = await Promise.all([loadToday(), loadMe(), loadMyStudyHref()]);
  return (
    <html lang="ko" className={`${plex.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <MeProvider me={me} myStudyHref={myStudyHref}>
          <TodayProvider today={today}>{children}</TodayProvider>
        </MeProvider>
      </body>
    </html>
  );
}
