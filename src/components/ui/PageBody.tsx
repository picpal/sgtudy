import type { ReactNode } from "react";

/**
 * AppHeader 아래 본문 틀 — 방 둘러보기(MainScreen main)와 같은 폭·여백: 안쪽 최대 1376px, 좌우 32px(≤640 16px), 위 36px·아래 64px(≤640 위 16px·아래 40px — 좌우 여백과 같은 16px 로 맞춘다).
 * 헤더 안쪽 틀과 같은 폭이라 로고와 본문 왼쪽 끝이 한 줄에 선다. flex-1 flex-col 이라 안쪽 카드가 남는 높이를 채울 수 있다.
 * `as="main"` 으로 페이지의 main 랜드마크로도 쓴다.
 */
export function PageBody({
  children,
  className = "",
  as: Tag = "div",
  "aria-hidden": ariaHidden,
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "main";
  "aria-hidden"?: boolean | "true" | "false";
}) {
  return (
    <Tag aria-hidden={ariaHidden} className={`mx-auto flex w-full max-w-[1376px] flex-1 flex-col px-8 pb-16 pt-9 max-sm:px-4 max-sm:pb-10 max-sm:pt-4 ${className}`}>
      {children}
    </Tag>
  );
}
