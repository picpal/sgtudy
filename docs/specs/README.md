# 구현 규약 (4개 화면 공통)

## 라우트 ↔ 아트보드
| 아트보드 | 라우트 | 페이지 파일 | 담당 폴더 |
|---|---|---|---|
| Main.dc.html | `/` | `src/app/page.tsx` | `src/components/main/`, `src/data/rooms.ts` |
| RoomView.dc.html | `/rooms/[id]` | `src/app/rooms/[id]/page.tsx` | `src/components/room-view/`, `src/data/room-view.ts` |
| RoomDetail.dc.html | `/my-study/[id]` (+ `/my-study` → 기본 방으로 redirect) | `src/app/my-study/[id]/page.tsx`, `src/app/my-study/page.tsx` | `src/components/my-study/`, `src/data/my-study.ts` |
| MySchedule.dc.html | `/schedule` | `src/app/schedule/page.tsx` | `src/components/schedule/`, `src/data/schedule.ts` |

- 화면 간 이동은 **반드시** `routes.*` (`src/lib/routes.ts`) 를 쓴다. 문자열 경로 하드코딩 금지.
- 다른 담당 폴더와 `src/components/ui/*`, `src/lib/*`, `globals.css`, `layout.tsx` 는 **수정하지 않는다**. 부족하면 자기 폴더 안에 만든다. (통합 단계에서 리드가 합친다)

## 공용 모듈
- `src/components/ui/AppHeader.tsx` — `<AppHeader active="home|myStudy|schedule" variant="flat|card">{검색창 등}</AppHeader>`
- `src/components/ui/Avatar.tsx` — 이니셜 아바타 (`pending`, `strong`, `size`)
- `src/components/ui/StatusIcon.tsx` — 사람별 상태 아이콘 5종 (모양+색)
- `src/components/ui/Badge.tsx`, `ProgressBar.tsx`
- `src/lib/palette.ts` — PAL / AVATAR_PAL / toneOf(name)
- `src/lib/date.ts` — parseISO / addDays / diffDays / dday / md / weekdayKo
- `src/lib/types.ts` — TaskStatus, RoomStatus, 라벨
- `src/lib/routes.ts` — routes, TODAY(`2026-10-12`), ME(철수)
- `globals.css` — 색 토큰이 Tailwind 색으로 등록됨: `bg-surface`, `text-ink`, `text-muted`, `border-line`, `bg-mint-soft`, `text-blue-text`, `bg-navy` … (목록은 globals.css `@theme` 참조). 스펙의 hex 가 토큰에 없으면 `style={{}}` 또는 `bg-[#hex]` 로 그대로 쓴다. `.clamp-2`, `.thin-scroll` 유틸 있음.

## 코딩 규칙
- Next.js 16 App Router + React 19 + Tailwind v4. 상태가 있는 화면은 `"use client"` 컴포넌트로 만들고, `page.tsx` 는 서버 컴포넌트로 얇게 유지.
- 동적 라우트의 `params` 는 Promise → `const { id } = await params`. `generateStaticParams` 로 목업 id 전부 내보낸다. 없는 id 는 `notFound()`.
- 아이콘은 인라인 stroke SVG (`aria-hidden`), 이모지 금지. 버튼은 `<button>`, 이동은 `<Link>`. 터치 타깃 ≥ 44px.
- 폰트는 layout 에서 IBM Plex Sans KR 로드됨 — 따로 넣지 말 것.
- 스펙의 수치(px, hex, radius, 폰트 크기/굵기)는 그대로 옮긴다. 임의로 "개선"하지 않는다.
- 반응형: 스펙의 900px 분기 + 390px 모바일에서 가로 스크롤 없이 쌓이도록. 좌우 패딩은 모바일 16px.
- 목업 데이터는 `src/data/<화면>.ts` 에 타입과 함께 둔다. 원본 `.dc.html` 의 문구·숫자를 그대로 옮긴다.
- 완료 전 `npm run lint && npx tsc --noEmit` 통과. `npm run build` 는 리드가 돌린다 (동시에 돌리면 `.next` 충돌).
