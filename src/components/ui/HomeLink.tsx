"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { routes } from "@/lib/routes";

/**
 * 방 둘러보기(/)로 가는 링크 — 화면에 보이기만 해서는 미리 받지 않고, 손이 가면(hover·focus·touch) 받는다.
 *
 * / 는 동적 라우트(루트 layout 이 쿠키를 읽는다)이고 (home)/loading.tsx 가 있어, 기본 Link 는 화면에 들어오는 순간
 * "loading 경계까지" 프리페치(/?_rsc, next-router-prefetch)를 서버에 보낸다. 이 요청은 지금 화면 트리와 다른 부분만 받으므로
 * 홈에 있을 땐 생략되고, 홈을 떠나는 순간(헤더 로고·"방 둘러보기" 가 새 화면에 또 보인다) 매번 나간다 → 홈 → 내 스터디 이동마다 /?_rsc 가 하나 더.
 * 뷰포트 프리페치를 끄고 의도가 보일 때만 router.prefetch 로 같은 loading 경계를 받아, 홈으로 돌아갈 때 골격은 그대로 즉시 뜬다.
 */
export function HomeLink({ onPointerEnter, onFocus, onTouchStart, ...props }: Omit<ComponentProps<typeof Link>, "href" | "prefetch">) {
  const router = useRouter();
  const warm = () => router.prefetch(routes.home());
  return (
    <Link
      {...props}
      href={routes.home()}
      prefetch={false}
      onPointerEnter={(e) => {
        warm();
        onPointerEnter?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      onTouchStart={(e) => {
        warm();
        onTouchStart?.(e);
      }}
    />
  );
}
