"use client";

import { GuardedLink as Link } from "@/components/ui/GuardedLink";

/**
 * 방 설정의 "돌아가기" 버튼 두 개 — 둘 다 GuardedLink 라 저장 안 한 수정이 있으면 leaveGuard 확인을 거친다.
 * 모양은 진행목표 상세·편집의 [← 진행목표] 버튼(DetailView·EditView)과 같은 클래스·화살표(높이 44px).
 * 목적지: 방 설정으로 오는 길(내 스터디 개요·헤더 정보, 방 보기 그룹장 패널·더보기)에 믿을 만한 referrer/returnTo 규칙이 없어
 * 위쪽 "내 스터디로" 와 같은 내 스터디 화면으로 보낸다.
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
 * 카드 오른쪽 바깥 여백의 "이전 페이지" — 카드(relative) 높이만큼의 레일 끝에 sticky bottom 으로 붙어, 스크롤해도 화면 아래에 보인다.
 * 위치는 카드 기준(left-full) 이라 카드 폭이 바뀌어도 따라간다. bottom-3 은 저장 막대(카드 안 sticky bottom-0, py-3)의 버튼 높이와 맞춘 값 —
 * 막대는 카드 안, 이 버튼은 카드 밖이라 겹치지 않는다.
 * 좁은 화면(오른쪽 여백 < 간격 16 + 버튼 ≈ 150px)에서는 숨긴다 — 위쪽 "내 스터디로" 가 같은 곳으로 가고, 떠 있는 버튼이 저장 막대·폼을 가리지 않게.
 * 여백 = (화면폭 − 카드폭)/2 이라 기준은 카드 880px 에 맞춘 1200px(여백 160px). 카드 폭을 바꾸면 카드폭 + 2×(16+버튼 ≈ 130) 이상으로 함께 바꾼다.
 */
export function SideBackRail({ href }: { href: string }) {
  return (
    <div data-testid="side-back-rail" className="pointer-events-none absolute inset-y-0 left-full hidden w-max flex-col justify-end pl-4 min-[1200px]:flex">
      <Link href={href} className={`${BACK_CLASS} pointer-events-auto sticky bottom-3 z-10 whitespace-nowrap shadow-[0_4px_14px_rgba(27,34,48,.08)]`}>
        <Arrow />
        이전 페이지
      </Link>
    </div>
  );
}
