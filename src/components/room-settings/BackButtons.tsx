"use client";

import { GuardedLink as Link } from "@/components/ui/GuardedLink";

/**
 * 방 설정의 "돌아가기" 버튼 두 개 — 둘 다 GuardedLink 라 저장 안 한 수정이 있으면 leaveGuard 확인을 거친다.
 * 모양은 진행목표 상세·편집의 [← 진행목표] 버튼(DetailView·EditView)과 같은 클래스·화살표(높이 44px).
 * 목적지: 위쪽 "내 스터디로" 는 늘 내 스터디. 옆 "이전 페이지" 는 설정을 연 화면 — 설정으로 오는 링크(방 보기 그룹장 패널·더보기,
 * 내 스터디 헤더·개요·더보기)가 ?from= 을 싣고, page.tsx 가 settingsBackOf 로 검증해 넘긴다(없으면 내 스터디).
 * router.back() 이 아니라 명시 주소라 가드(GuardedLink)가 목적지를 알고, 확인 뒤에도 같은 곳으로 간다.
 */
const BACK_CLASS = "inline-flex h-11 shrink-0 items-center gap-[6px] rounded-[22px] border border-line-3 bg-surface pl-3 pr-4 text-[14px] font-semibold text-ink";

function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

/** 카드 위쪽 "내 스터디로" */
export function TopBackLink({ href }: { href: string }) {
  return (
    <Link href={href} className={BACK_CLASS}>
      <Arrow />
      내 스터디로
    </Link>
  );
}

/**
 * 카드 왼쪽 바깥 여백의 "이전 페이지" — 카드(relative) 높이만큼의 레일 끝에 sticky bottom 으로 붙어, 스크롤해도 화면 아래에 보인다.
 * 위치는 카드 기준(right-full) 이라 카드 폭이 바뀌어도 따라간다. bottom-3 은 저장 막대(카드 안 sticky bottom-0, py-3)의 버튼 높이와 맞춘 값 —
 * 막대는 카드 안, 이 버튼은 카드 밖이라 겹치지 않는다.
 * 좁은 화면(왼쪽 여백 < 간격 16 + 버튼 ≈ 150px)에서는 숨긴다 — 위쪽 "내 스터디로" 가 같은 곳으로 가고, 떠 있는 버튼이 저장 막대·폼을 가리지 않게.
 * 여백 = (화면폭 − 카드폭)/2 이라 기준은 카드 880px 에 맞춘 1200px(여백 160px). 카드 폭을 바꾸면 카드폭 + 2×(16+버튼 ≈ 130) 이상으로 함께 바꾼다.
 */
/** 스크린리더용 목적지 이름 — 보이는 글자는 "이전 페이지" 그대로 */
export function backLabelOf(href: string): string {
  if (href.startsWith("/my-study")) return "이전 페이지 — 내 스터디로";
  if (href.startsWith("/rooms/")) return "이전 페이지 — 방 보기로";
  return "이전 페이지";
}

export function SideBackRail({ href }: { href: string }) {
  return (
    <div data-testid="side-back-rail" className="pointer-events-none absolute inset-y-0 right-full hidden w-max flex-col items-end justify-end pr-4 min-[1200px]:flex">
      <Link href={href} aria-label={backLabelOf(href)} className={`${BACK_CLASS} pointer-events-auto sticky bottom-3 z-10 whitespace-nowrap shadow-[0_4px_14px_rgba(27,34,48,.08)]`}>
        <Arrow />
        이전 페이지
      </Link>
    </div>
  );
}
