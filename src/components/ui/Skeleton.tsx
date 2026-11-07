import type { ReactNode } from "react";
import { AppHeader, type NavKey } from "./AppHeader";
import { PageBody } from "./PageBody";

/*
 * 라우트 loading.tsx 용 화면 골격. 메뉴를 누르면 서버 응답(RSC)을 기다리지 않고 바로 이 골격으로 바뀐다(프리페치된 폴백).
 * 헤더는 진짜 AppHeader(활성 메뉴 그대로) — 알림 벨만 자리 표시로 둔다(벨은 마운트 때 조회하므로 골격에서 부르지 않는다).
 * 레이아웃은 각 화면과 같은 한 페이지 스크롤 틀(min-h-screen, 카드는 내용만큼)이다.
 */

function Bar({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`block rounded-[8px] bg-line-2 motion-safe:animate-pulse ${className}`} />;
}

function BellSlot() {
  return <span aria-hidden="true" className="block h-11 w-11 rounded-[12px] border border-line bg-surface" />;
}

function Shell({ active, children }: { active?: NavKey; children: ReactNode }) {
  return (
    <div data-skeleton="" aria-busy="true" className="flex min-h-screen flex-col">
      <AppHeader active={active} bell={<BellSlot />} />
      <span className="sr-only" role="status">불러오는 중</span>
      <PageBody>{children}</PageBody>
    </div>
  );
}

function SideCard({ rows = 4 }: { rows?: number }) {
  return (
    <aside aria-hidden="true" className="flex flex-[1_1_300px] flex-col gap-[14px] rounded-[20px] bg-surface px-5 pb-5 pt-[22px] max-[901px]:max-w-none max-[901px]:py-[14px] min-[901px]:max-w-[380px]">
      <Bar className="h-6 w-28" />
      <Bar className="h-[42px] w-full rounded-[21px] max-[901px]:hidden" />
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="flex flex-col gap-3 rounded-[16px] border border-line px-4 py-[14px] max-[901px]:hidden">
          <Bar className="h-[26px] w-24 rounded-[13px]" />
          <Bar className="h-5 w-4/5" />
          <Bar className="h-4 w-3/5" />
        </span>
      ))}
    </aside>
  );
}

function DetailMain({ tabs }: { tabs: boolean }) {
  return (
    <main className="min-w-0 flex-[999_1_640px] rounded-[20px] bg-surface px-7 pb-9 pt-7 max-[901px]:order-first max-[901px]:px-4">
      <div className="flex flex-wrap items-start gap-7">
        <section className="flex min-w-0 flex-[999_1_460px] flex-col gap-4">
          <Bar className="h-[26px] w-32 rounded-[13px]" />
          <Bar className="h-8 w-3/4" />
          <Bar className="h-4 w-full" />
          <Bar className="h-4 w-2/3" />
          {tabs && (
            <span className="mt-[10px] flex gap-2 border-y border-line-2 py-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Bar key={i} className="h-9 w-16" />
              ))}
            </span>
          )}
          <Bar className="h-40 w-full rounded-[16px]" />
          <Bar className="h-24 w-full rounded-[16px]" />
        </section>
        <span className="flex max-w-[360px] flex-[1_1_300px] flex-col gap-[14px]">
          <Bar className="h-44 w-full rounded-[16px]" />
          <Bar className="h-28 w-full rounded-[16px]" />
        </span>
      </div>
    </main>
  );
}

/** FilterBar 탭 3개·상태 칩 4개의 실제 폭 — 탭과 칩이 같은 폭에서 줄바꿈된다 */
const SKELETON_TABS = ["w-[129px] max-sm:w-[116px]", "w-[143px] max-sm:w-[129px]", "w-[129px] max-sm:w-[116px]"];
const SKELETON_STATUSES = ["w-[53px]", "w-[65px]", "w-[65px]", "w-[53px]"];
/** 태그 칩 개수(평균 89px) — 실제 개수는 응답이 와야 안다. 운영 태그가 적어(전체 6개, 한 방 3개) 실제도 한 줄이라 폭 640 이상 어디서나 한 줄로 둔다 */
const SKELETON_TAG_COUNT = 4;

/** / — 방 카드 격자 (MainScreen 의 헤더 + 카드 그리드) */
export function HomeSkeleton() {
  return (
    <div data-skeleton="" aria-busy="true" className="min-h-screen text-ink">
      <AppHeader active="home" bell={<BellSlot />}>
        <Bar className="h-10 min-w-40 flex-[0_1_280px] rounded-[12px]" />
      </AppHeader>
      <span className="sr-only" role="status">불러오는 중</span>
      <PageBody as="main" aria-hidden="true">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4 max-sm:mb-5 max-sm:items-center max-sm:gap-3">
          {/* 제목 42px·설명 22.5px·간격 6px = 70.5px(폭 <640 은 설명 21px, 375 미만 두 줄 42px) — 실제 머리 줄과 같은 높이로 */}
          <div className="flex flex-col gap-[6px] max-sm:contents">
            <Bar className="my-[5px] h-8 w-40 max-sm:my-0 max-sm:w-24" />
            <Bar className="h-[22.5px] w-72 max-w-full max-sm:order-1 max-sm:-mt-2 max-sm:basis-full min-[375px]:max-sm:h-[21px] max-[375px]:h-[42px]" />
          </div>
          <Bar className="h-[46px] w-32 rounded-[14px] max-sm:h-11 max-sm:w-[113px] max-sm:rounded-[12px]" />
          <Bar className="h-11 basis-full rounded-[12px] max-sm:order-2 min-[1056px]:hidden" />
        </div>
        {/* 여기부터 FilterBar 와 같은 틀(줄 클래스·탭/칩 폭) — 골격이 끝날 때 카드가 밀리지 않게. 태그 줄 수만 데이터에 달렸다(폭 ≥640 은 실제가 두 줄이 되면 줄당 44px 차이) */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line">
          <span className="flex min-w-0 max-w-full gap-1 max-sm:-mx-4 max-sm:w-[calc(100%+2rem)] max-sm:max-w-none max-sm:overflow-hidden max-sm:px-4 max-sm:pb-px">
            {SKELETON_TABS.map((w, i) => (
              <span key={i} className={`-mb-px flex h-12 shrink-0 items-center px-[14px] max-sm:px-[10px] ${w}`}>
                <Bar className="h-5 w-full" />
              </span>
            ))}
          </span>
          <span className="flex flex-wrap gap-x-[6px] gap-y-[10px] pb-[10px]">
            {SKELETON_STATUSES.map((w, i) => (
              <Bar key={i} className={`h-[34px] rounded-[17px] ${w}`} />
            ))}
          </span>
        </div>
        <div className="-mt-2 mb-6 flex flex-wrap items-center gap-x-2 gap-y-3 max-sm:mb-4 max-sm:-mt-3 max-sm:gap-y-1">
          <Bar className="mr-1 h-[19.5px] w-[42px]" />
          <span className="contents max-sm:-mr-4 max-sm:flex max-sm:min-w-0 max-sm:flex-1 max-sm:gap-2 max-sm:overflow-hidden max-sm:py-[6px] max-sm:pr-4">
            {Array.from({ length: SKELETON_TAG_COUNT }, (_, i) => (
              <Bar key={i} className="h-8 w-[89px] shrink-0 rounded-2xl" />
            ))}
          </span>
        </div>
        <div className="grid gap-6 max-sm:gap-4 [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="flex flex-col gap-[10px] rounded-[18px] border border-line bg-surface px-[18px] pb-4 pt-[18px]">
              <Bar className="h-6 w-20" />
              <Bar className="h-12 w-full" />
              <Bar className="h-[43px] w-full" />
              <Bar className="mt-2 h-6 w-1/2" />
            </span>
          ))}
        </div>
      </PageBody>
    </div>
  );
}

/** /my-study, /my-study/[id] — 내 스터디 목록 + 방 정보·탭 */
export function MyStudySkeleton() {
  return (
    <Shell active="myStudy">
      <div className="flex w-full items-start gap-4 max-[901px]:flex-wrap">
        <SideCard />
        <DetailMain tabs />
      </div>
    </Shell>
  );
}

/** /rooms/[id] — 전체 스터디 목록 + 방 정보·참가 카드 */
export function RoomSkeleton() {
  return (
    <Shell active="home">
      <div className="flex w-full items-start gap-4 max-[901px]:flex-wrap">
        <SideCard />
        <DetailMain tabs={false} />
      </div>
    </Shell>
  );
}

/** /schedule — 월 달력 + 일정 요약 */
export function ScheduleSkeleton() {
  return (
    <Shell active="schedule">
      <div aria-hidden="true" className="flex w-full items-start gap-4 max-[901px]:flex-wrap">
        <main className="flex min-w-0 flex-[999_1_720px] flex-col gap-4 rounded-[20px] bg-surface px-6 pt-6 pb-[18px] max-sm:px-4 max-sm:pt-4">
          <span className="flex items-center gap-3">
            <Bar className="h-8 w-40" />
            <Bar className="h-10 w-10 rounded-full" />
            <Bar className="h-10 w-10 rounded-full" />
            <span className="flex-1" />
            <Bar className="h-10 w-28 rounded-[12px]" />
          </span>
          <span className="grid grid-cols-7 overflow-clip rounded-[16px] border border-line">
            {Array.from({ length: 42 }, (_, i) => (
              <span key={i} className="h-[96px] border-b border-r border-line-2 p-2 min-[901px]:h-[112px]">
                <Bar className="h-[22px] w-[22px] rounded-full" />
              </span>
            ))}
          </span>
        </main>
        <span className="flex min-w-0 flex-col gap-4 max-[901px]:basis-full min-[901px]:flex-[0_0_340px] min-[1201px]:basis-[380px]">
          <span className="flex flex-col gap-3 rounded-[20px] bg-surface p-5">
            <Bar className="h-6 w-32" />
            <Bar className="h-16 w-full rounded-[12px]" />
          </span>
          <span className="flex flex-col gap-3 rounded-[20px] bg-surface p-5">
            <Bar className="h-5 w-36" />
            <Bar className="h-12 w-full rounded-[12px]" />
            <Bar className="h-12 w-full rounded-[12px]" />
          </span>
        </span>
      </div>
    </Shell>
  );
}

/** /tasks — 제목·요약 + 필터 + 회차 묶음 카드 */
export function TasksSkeleton() {
  return (
    <Shell active="tasks">
      <main aria-hidden="true" className="mx-auto flex w-full max-w-[1080px] flex-col gap-4 rounded-[20px] bg-surface px-7 pb-[30px] pt-[26px] max-sm:px-4 max-sm:pt-5">
        <span className="flex items-start gap-3">
          <span className="flex flex-1 flex-col gap-2">
            <Bar className="h-8 w-28" />
            <Bar className="h-4 w-64 max-w-full" />
          </span>
          <Bar className="h-11 w-32 rounded-[12px] max-sm:w-20" />
        </span>
        <Bar className="h-[92px] w-full rounded-[16px]" />
        {Array.from({ length: 2 }, (_, i) => (
          <span key={i} className="flex flex-col gap-2">
            <Bar className="h-5 w-48" />
            <span className="flex flex-col overflow-clip rounded-[16px] border border-line">
              <span className="flex items-center gap-3 bg-surface-3 px-[18px] py-3">
                <Bar className="h-6 w-14 rounded-[7px]" />
                <Bar className="h-5 w-40" />
              </span>
              {Array.from({ length: 3 }, (_, j) => (
                <span key={j} className="flex min-h-14 items-center gap-3 border-t border-line-2 px-4">
                  <Bar className="h-[22px] w-[22px] rounded-full" />
                  <Bar className="h-4 flex-1" />
                  <Bar className="h-6 w-16 rounded-[8px] max-sm:hidden" />
                </span>
              ))}
            </span>
          </span>
        ))}
      </main>
    </Shell>
  );
}

/** /me — 프로필 카드 */
export function ProfileSkeleton() {
  return (
    <Shell>
      <main aria-hidden="true" className="mx-auto flex w-full max-w-[560px] flex-col gap-5 rounded-[20px] bg-surface p-7 max-sm:p-5">
        <span className="flex items-center gap-4">
          <Bar className="h-16 w-16 rounded-full" />
          <span className="flex flex-col gap-2">
            <Bar className="h-7 w-28" />
            <Bar className="h-4 w-44" />
          </span>
        </span>
        {Array.from({ length: 2 }, (_, i) => (
          <span key={i} className="flex flex-col gap-[6px]">
            <Bar className="h-4 w-16" />
            <Bar className="h-12 w-full rounded-[12px]" />
          </span>
        ))}
        <Bar className="h-12 w-full rounded-[24px]" />
      </main>
    </Shell>
  );
}
