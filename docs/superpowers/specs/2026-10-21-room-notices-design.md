# 그룹장 공지사항(방 공지 · 진입 팝업) 설계

- 작성: 2026-10-21
- 요청(요지): my-study 방 화면 **개요 탭 오른쪽에 「공지사항」 탭**. 그룹장이 공지를 등록. **옵션**에 따라 스터디룸 진입 시 공지를 **팝업**으로 띄우고 배경은 흐리게(dim/blur). 팝업은 **1회** — 사용자가 확인하면 다시 뜨지 않고, 공지사항 탭 리스트에 남아 재확인 가능.
- 마이그레이션: `0040_room_notices.sql` (착수 시점 최신 번호 다음 — 0039 `room_public_active` 이후. 다른 작업이 0040 을 먼저 쓰면 다음 번호)
- 범위: 설계만. 구현 전 D-list 확정 필요.

---

## 1. 현재 상태 (근거)

| 영역 | 지금 동작 | 근거 |
|---|---|---|
| 방 탭 | `TABS` = 개요·진행목표·보드·캘린더·간트. 탭 키는 `MY_STUDY_TABS`(routes) 가 원본, `?tab=` 이 목록 주소에 동기화(`syncListTab`). 탭바 `role="tablist"` + `overflow-x-auto` | `StudyHeaderInfo.tsx:15,132` · `routes.ts:54` · `MyStudyScreen.tsx:59` |
| 화면 상태 | `ScreenState`(state.ts) 단일 리듀서. 탭 이동은 `tabPatch` → 미저장(`blocksLeave`)이면 `leave` 보류 후 확인 | `state.ts` |
| 페이지 키 | `MyStudyScreen key = id:task:tab` — 같은 방 다른 `?tab=` 링크는 재마운트 | `app/my-study/[id]/page.tsx:47` |
| 권한 | 그룹장 = `rooms.leader_id`. 위임 편집자 = `room_members.can_edit_curriculum`(진행목표만). 그룹장 RPC 는 `leader_room(slug, lock)` → `require_leader`(못 읽으면 ROOM_NOT_FOUND, 아니면 NOT_LEADER) | 0004 · 0008 · 0011 |
| 읽기 권한 | `room_readable` = 그룹장 · 멤버(ACTIVE·INACTIVE·PENDING) · 공개/초대 | 0004 |
| 편집 가능 상태 | 쓰기 RPC 공통: `archived_at is null ∧ status in (DRAFT,RECRUIT,ACTIVE)` 아니면 `ROOM_NOT_EDITABLE` | 0011 `node_assert_editable` · 0039 `room_update` |
| 모달 | `ConfirmDialog` — `role=alertdialog`·`aria-modal`·포커스 트랩·Esc·바깥 클릭·닫힐 때 연 버튼으로 포커스 반환. 배경 `bg-[rgba(27,34,48,.4)]`, blur 없음 | `ui/ConfirmDialog.tsx` |
| 마크다운 | 편집 `ui/markdown-editor`(`MarkdownEditor`), 표시 `my-study/MarkdownView`. 설명 md 상한 20,000자 관행 | 0014 · 0034 |
| 알림 | `notify_publish(kind, room, node, actor, recipients, dedupe_prefix, model)` → 벨(`NotificationBell`). kind 추가 = `notification_kinds`·`notify_render`·`notify_link` 재정의(최신 0037). 방 설정 필터 `notify_enabled`(모르는 kind 는 true) | 0008 · 0037 |
| 메일 | `mail_outbox` 표만 있고 생산자·발송기 없음(정리 cron 만) | 0001 · 0008 |
| RLS 관행 | 새 표는 `enable row level security` + `revoke all … from anon, authenticated` + 정책 없음 → 접근은 전부 `security definer set search_path=''` RPC | 0003 · 0037 |
| MCP | `api_invoke` op 은 진행목표·시험 중심. 방 관리는 MCP 범위 밖 | 0035 · 0038 |

**요약**: 공지는 진행목표 트리와 독립된 작은 도메인이다. 표 2개 + RPC 6개 + 알림 kind 1개 + 탭 1개 + 다이얼로그 1개로 끝난다. 기존 리듀서·탭 규칙(`tabPatch`·`blocksLeave`)에 얹는다.

---

## 2. 목표 · 비목표

**목표**
1. 개요 오른쪽 「공지」 탭: 공지 리스트(고정 → 최신순), 항목 펼쳐 본문(md) 읽기, 안 읽은 표시.
2. 그룹장은 공지 작성·수정·삭제·고정. 작성 시 **"입장 시 팝업으로 알리기"** 옵션.
3. 팝업 옵션이 켜진 공지는 멤버가 방에 들어올 때 dim+blur 모달로 뜬다. **[확인]** 하면 그 멤버에게 다시 뜨지 않는다. 탭 리스트엔 그대로 남는다.
4. 공지 등록 시 벨 알림.

**비목표(v1)**: 댓글·반응, 첨부 파일·이미지 업로드(링크·md 이미지 URL 은 허용), 예약 게시, 읽음 현황 상세(누가 읽었나 목록), 메일 발송, MCP 노출, 위임 편집자 작성 권한.

---

## 3. 결정 사항 (D-list)

| # | 결정 | 선택지 | 권장 |
|---|---|---|---|
| D1 | 작성 권한 | A 그룹장만 · B 그룹장+진행목표 편집 위임자 | **A** — 요청이 "그룹장". 위임은 진행목표 범위 권한이라 의미가 다름. 필요 시 별도 플래그로 확장 |
| D2 | 읽음/확인 저장 | A `notices` 에 배열 컬럼 · B 사용자별 `notice_reads` 표 | **B** — 멤버 수만큼 행 갱신 경합·배열 비대 없음, 미읽음 배지·재팝업 리비전 비교가 한 조인 |
| D3 | 필드 | 제목 · 본문(md) · 팝업 · 고정 · 작성/수정 시각 | **제목(1~80) + 본문 md(1~10,000) + `popup` + `pinned`** — 기존 md 렌더러 재사용. 본문 필수(제목만 공지는 팝업이 빈약) |
| D4 | 수정 시 재팝업 | A 항상 · B 안 함 · C 그룹장이 수정 폼에서 "다시 알리기" 체크 | **C** — `popup_rev` 를 올릴 때만 재노출. 오타 수정마다 팝업되는 피로 방지. 기본 꺼짐 |
| D5 | 팝업 대기 여러 개 | A 최신 1개만 · B 큐(순서대로) · C 한 다이얼로그에 목록 | **B** — 고정 우선, 그 다음 오래된 순. "1/3" 표시 + [확인] 시 다음 장. 최대 5개(D11 상한과 동일) |
| D6 | 나중 합류자 | A 합류 이전 팝업 공지도 노출 · B 합류 이후 것만 | **A** — 팝업 = "모두 꼭 봐야 하는 규칙" 의도. 그룹장이 `popup` 을 끄면 더 안 뜸. 오래된 건 끄라는 안내 문구로 관리 |
| D7 | 확인 의미 | A [확인] 버튼만 확인 · B 닫기(Esc·X·배경)도 확인 | **A** — Esc/X = "나중에"(이번 방문만 숨김, `sessionStorage`), 배경 클릭은 무반응(포커싱 의도). 탭에서 펼쳐 읽어도 확인으로 친다(D2 와 같은 행) |
| D8 | 게시 알림 | A 없음 · B 벨 · C 벨+메일 | **B** — 새 kind `NOTICE_POSTED`. 메일은 발송기 없음(`mail_outbox` 미가동) → 후속. 수정은 D4 "다시 알리기" 때만 벨 재발행 |
| D9 | 탭 미읽음 배지 | A 없음 · B 점 · C 숫자 | **B 점** — 탭 라벨 옆 6px 점 + `aria-label="공지, 안 읽은 공지 있음"`. 숫자는 탭바 높이·모바일 폭에 부담 |
| D10 | 열람 대상 | A room_readable 전부 · B 그룹장+ACTIVE+INACTIVE · C 그룹장+ACTIVE | **B** — 공개 방 외부인·PENDING 에겐 숨김(내부 운영 공지). INACTIVE(이탈)는 읽기만, 팝업 없음. PENDING 은 "참가가 승인되면 볼 수 있어요" |
| D11 | 상한 | — | **방당 공지 100개, 고정 3개, 팝업 켜짐 5개.** 넘으면 `NOTICE_LIMIT`(details.kind = total·pinned·popup) |
| D12 | 종료·보관 방 | A 계속 작성 · B 읽기 전용 | **B** — 쓰기는 DRAFT/RECRUIT/ACTIVE ∧ 비보관(기존 `ROOM_NOT_EDITABLE`). ENDED·보관 방은 팝업도 끔(진입 시 방해 X), 리스트는 읽기 가능 |
| D13 | 삭제 | A 하드 삭제 · B 소프트 삭제 | **A** — 확인 대화상자 후 삭제, `notice_reads` cascade. 이미 발송된 벨 알림은 탭으로 링크되므로 깨지지 않음 |
| D14 | 상세 URL | A `?notice={id}` 전용 상세 · B 탭 안 펼침(아코디언) | **B** — 기존 상세 history 기계(`openItem`·`backTab`)에 안 얹음. 알림 링크는 `?tab=notice` |
| D15 | 팝업 데이터 경로 | A `room_detail`/서버 렌더에 포함 · B 마운트 후 `notice_inbox` RPC | **B** — 상세 RPC(다른 작업이 수정 중) 비접촉, 가벼움. 팝업은 첫 페인트 뒤 열려도 무방 |
| D16 | MCP | 노출 · 비노출 | **비노출** — MCP 는 방 관리 범위 밖(기존 결정). 후속 시 읽기 op 만 |
| D17 | 그룹장 본인 팝업 | 띄움 · 안 띄움 | **안 띄움** — 작성자는 내용을 안다. 그룹장의 미읽음 배지도 0(작성=읽음 처리) |
| D18 | 작성 UI 위치 | A 탭 상단 인라인 폼 · B 모달 에디터 | **A** — md 에디터는 넓은 폭이 필요. 모달 안 모달(확인) 중첩 피함. 미저장 이탈 가드는 `blocksLeave` 에 `noticeUnsaved` 추가 |

---

## 4. 데이터 모델 (0040)

```sql
create table public.room_notices (
  id          bigint generated always as identity primary key,
  room_id     bigint not null references public.rooms(id) on delete cascade,
  author_id   uuid   references public.profiles(id) on delete set null,
  title       text   not null check (char_length(title) between 1 and 80),
  body_md     text   not null check (char_length(body_md) between 1 and 10000),
  popup       boolean not null default false,
  popup_rev   int     not null default 1,      -- "다시 알리기" 때 +1 (D4)
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index room_notices_room_idx on public.room_notices (room_id, pinned desc, created_at desc);

create table public.room_notice_reads (
  notice_id   bigint not null references public.room_notices(id) on delete cascade,
  user_id     uuid   not null references public.profiles(id) on delete cascade,
  read_rev    int    not null,                  -- 확인한 popup_rev
  read_at     timestamptz not null default now(),
  primary key (notice_id, user_id)
);
alter table public.room_notices      enable row level security;
alter table public.room_notice_reads enable row level security;
revoke all on public.room_notices, public.room_notice_reads from anon, authenticated;   -- 정책 없음 = RPC 전용
```

- **읽음 판정**: `reads.read_rev >= notices.popup_rev` 면 읽음. 행 없으면 안 읽음.
- **팝업 대기**: `popup ∧ 미읽음 ∧ viewer = ACTIVE 멤버(그룹장 제외) ∧ 방 status ≠ ENDED ∧ 비보관`.
- 상한(D11)은 `notice_create`/`notice_update` 안에서 `room_lock` 후 count 로 검사(트리거 아님 — 관행상 RPC 검증).

## 5. RPC (전부 `security definer set search_path = ''`, `grant execute … to authenticated`)

| 함수 | 권한 | 동작 | 반환 |
|---|---|---|---|
| `notice_list(p_slug)` | D10 열람자 | 고정 → 최신순 전체(≤100) | `{ items: Notice[], canWrite, limits }` |
| `notice_inbox(p_slug)` | D10 열람자 | 미읽음 존재 여부 + 팝업 대기 큐(D5 순서, ≤5) | `{ unread: bool, popups: Notice[] }` |
| `notice_create(p_slug, p_input jsonb)` | 그룹장(`leader_room(slug, true)`) + 편집 가능 상태 | 검증·상한 → insert → 작성자 reads 행 → `notify_publish('NOTICE_POSTED', …, ACTIVE 멤버, 'NOTICE_POSTED:'||id||':1')` | `Notice` |
| `notice_update(p_slug, p_id, p_patch jsonb)` | 동일 | 키 화이트리스트 `title·bodyMd·popup·pinned·renotify`. `renotify=true` 면 `popup_rev+1`(popup 강제 true) + 벨 재발행(dedupe `…:rev`) | `Notice` |
| `notice_delete(p_slug, p_id)` | 동일 | 삭제 | `null` |
| `notice_read(p_slug, p_ids bigint[])` | D10 열람자 | upsert `read_rev = popup_rev` (확인·펼침 공용, 멱등) | `{ unread: bool }` |

- `Notice` JSON: `{ id, title, bodyMd, popup, pinned, author: person_json, createdAt, updatedAt, edited: updated_at > created_at + 1분, read: bool }`.
- 오류: `ROOM_NOT_FOUND`·`NOT_LEADER`(require_leader 규칙), `ROOM_NOT_EDITABLE`, `VALIDATION_FAILED`(field: title/bodyMd), `NOTICE_NOT_FOUND`(다른 방 id 포함), `NOTICE_LIMIT`, PENDING/외부인 읽기 = `NOT_ROOM_MEMBER`(읽기 가능 방) / `ROOM_NOT_FOUND`.
- 알림 kind 추가: `notification_kinds`·`notify_render`(`'%s 새 공지: %s'` 방·제목, body = 방 제목)·`notify_link`(`/my-study/{slug}?tab=notice`) 를 0037 판 그대로 + 1개 재정의. `notify_enabled` 는 모르는 kind → true 라 변경 없음(방 알림 설정 토글은 v1 없음).

## 6. 클라이언트

### 6.1 API · 라우트
- `src/lib/api/notices.ts`: `fetchNotices`·`fetchNoticeInbox`·`createNotice`·`updateNotice`·`deleteNotice`·`markNoticesRead` (`rpc<…>` 관행). 타입은 `types.ts` 에 `Notice`·`NoticeInbox`.
- `routes.ts`: `MY_STUDY_TABS = ["overview", "notice", "curriculum", …]`. `StudyHeaderInfo.TABS` 2번째에 `["notice", "공지"]`. (라벨: 모바일 폭 고려 "공지사항" 대신 "공지" — 탭 헤더 `h2` 는 "공지사항")

### 6.2 상태 (state.ts)
- 추가: `noticeOpen: string | null`(펼친 공지), `noticeEdit: { id: string | "new" } | null`, `noticeUnsaved: boolean`.
- `blocksLeave` 에 `S.tab === "notice" && S.noticeUnsaved` OR 조건. 기존 `leave` 보류·확인 흐름 재사용.
- 탭 미읽음 점은 `notice_inbox.unread` 로 시작, `notice_read`/작성 응답의 `unread` 로 갱신.

### 6.3 NoticeTab (`tabs/NoticeTab.tsx`)
- 상단: `h2 공지사항` + (그룹장·편집 가능 상태) `[공지 쓰기]` 버튼.
- 인라인 폼(D18): 제목 input · `MarkdownEditor`(minHeight 200) · 체크박스 "입장 시 팝업으로 알리기" · "상단에 고정" · (수정 시, popup 켜짐일 때) "수정 내용을 다시 팝업으로 알리기" · `[취소]` `[등록|저장]`. 상한 도달 시 체크박스 disabled + 이유 문구.
- 리스트: 행 = 고정 핀 아이콘 · 팝업 배지("팝업") · 제목 · 안 읽음 점 · 작성일(`relativeTime`) · "수정됨". 클릭 → 아코디언 펼침 → `MarkdownView` + 그룹장 `RowMenu`(수정·고정/해제·팝업 끄기·삭제). 펼칠 때 미읽음이면 `notice_read([id])`.
- 삭제: `ConfirmDialog danger` "공지를 삭제할까요? / 삭제하면 멤버 목록에서도 사라져요."
- 보관·종료 방: 쓰기 버튼·메뉴 숨김 + 상단 `roomArchived` 와 같은 톤 안내.

### 6.4 NoticePopup (`my-study/NoticePopup.tsx`)
- 마운트 시 `notice_inbox` → `popups` 중 `sessionStorage['notice-later:{slug}']` 에 없는 것을 큐로. `MyStudyScreen` 최상단에서 렌더(어느 탭으로 들어와도).
- 다른 모달(`ConfirmDialog`)이 열려 있거나 편집 중 이탈 확인이 떠 있으면 대기.
- 구조: 오버레이 `fixed inset-0 z-50 bg-[rgba(27,34,48,.45)] backdrop-blur-sm` + 박스 `role="dialog" aria-modal="true" aria-labelledby aria-describedby`, 최대 폭 560, 본문 `max-h-[60vh] overflow-y-auto`.
- 헤더: "공지" 라벨 · `1/3` · 제목 · 작성자·날짜. 본문 `MarkdownView`. 하단 `[나중에 보기]`(보조) `[확인]`(주).
- [확인] → `notice_read([id])` → 다음 장 / 마지막이면 닫기. 실패 시 Toast "확인 처리에 실패했어요. 다시 시도해 주세요" + 닫지 않음.
- Esc·X·[나중에 보기] → 지금 장만 이번 세션 숨기고 다음 장으로, 남은 게 없으면 닫힘(D7, `id:rev` — 2026-10-21 후속에서 큐 전부 → 한 장씩으로 바꿈). 배경 클릭 무반응.
- 접근성: 열릴 때 포커스 = 제목(`tabIndex=-1`) — 긴 본문을 스크린리더가 처음부터 읽게. 포커스 트랩은 `ConfirmDialog` 의 `onTrapKey` 를 `useFocusTrap` 훅으로 추출해 공용(링크·버튼 포함 선택자). 열린 동안 `document.body` 스크롤 잠금 + 배경 `inert`. 닫히면 진입 전 포커스로 반환. 등장 애니메이션은 `motion-safe:` 접두로만(`prefers-reduced-motion` 존중).

### 6.5 모바일
- 탭바는 이미 `overflow-x-auto` — 6개 탭이 375px 에서 가로 스크롤 가능. 선택 탭 `scrollIntoView({inline:"nearest"})` 확인.
- 팝업: `max-sm:` 하단 시트형(좌우 16px, `rounded-t-[18px]`, 버튼 풀폭 2열), 본문 `max-h-[55vh]`.
- 인라인 폼: 체크박스 세로 정렬, 버튼 풀폭.

### 6.6 문구 (앱 톤 "~해요")
| 상황 | 문구 |
|---|---|
| 빈 리스트(그룹장) | "아직 공지가 없어요" / "모두가 알아야 할 규칙이나 일정을 공지로 남겨 보세요" + [공지 쓰기] |
| 빈 리스트(멤버) | "아직 공지가 없어요" / "그룹장이 공지를 올리면 여기에 모여요" |
| PENDING | "참가가 승인되면 공지를 볼 수 있어요" |
| 팝업 옵션 도움말 | "멤버가 방에 들어올 때 한 번 띄워요. 확인하면 다시 뜨지 않아요" |
| 상한 | "팝업 공지는 5개까지예요 · 오래된 공지의 팝업을 꺼 주세요" / "고정은 3개까지예요" / "공지는 100개까지예요" |
| 등록 토스트 | "공지를 올렸어요" (팝업이면 "공지를 올렸어요 · 멤버가 들어오면 팝업으로 보여요") |
| 미저장 이탈 | 기존 "저장하지 않은 수정이 있어요" 재사용 |

---

## 7. 테스트 계획

**SQL (`supabase/tests/notices-sql.test.ts`, pglite 하네스·`expectFail` 관행)**
- 권한: 그룹장 create/update/delete OK · ACTIVE 멤버·위임 편집자 `NOT_LEADER` · 외부인 `ROOM_NOT_FOUND` · PENDING 읽기 거부.
- 상태: ENDED·보관 방 쓰기 `ROOM_NOT_EDITABLE`, 읽기 OK, `notice_inbox.popups` 비어 있음.
- 검증: 제목 0/81자, 본문 0/10,001자, 알 수 없는 patch 키, 다른 방 id → `NOTICE_NOT_FOUND`.
- 상한: 101번째·고정 4번째·팝업 6번째 `NOTICE_LIMIT`(details.kind).
- 팝업: 생성 직후 멤버 inbox 에 1, 그룹장 0 · `notice_read` 후 0 · 멱등 · 일반 수정 후 0 유지 · `renotify` 후 다시 1 · `popup=false` 후 0 · 큐 순서(고정 → 오래된 순) · 나중 합류자 inbox 에 기존 팝업 노출 · INACTIVE 0.
- 알림: create 시 ACTIVE 멤버 수만큼 `NOTICE_POSTED`, 작성자 제외, link `?tab=notice` · 일반 update 0건 · renotify 1건/인 · 같은 rev 재호출 dedupe.
- RLS: `authenticated` 로 두 표 직접 select/insert 거부.

**DOM (vitest + testing-library, `*.dom.test.ts`)**
- `NoticeTab.dom.test.ts`: 빈 상태 문구(역할별) · 그룹장만 쓰기 버튼 · 폼 검증·상한 disabled · 펼침 시 `markNoticesRead` 1회 · 삭제 확인 · 종료 방 읽기 전용.
- `NoticePopup.dom.test.ts`: 큐 1/N 진행 · [확인] 호출·다음 장 · Esc/[나중에] = 미호출 + sessionStorage · 배경 클릭 무반응 · 포커스 진입(제목)·트랩·반환 · 실패 토스트 후 유지.
- `state.test.ts`: `blocksLeave` notice 분기 · `routes` 탭 파싱(`?tab=notice`).
- `StudyHeaderInfo`/`MyStudyScreen.dom.test.ts`: 탭 순서(개요 다음 공지) · 미읽음 점 aria.

**E2E**: 그룹장 계정으로 팝업 공지 등록 → 멤버 계정 진입 시 팝업(배경 blur 스크린샷) → [확인] → 새로고침 시 미노출 → 공지 탭 리스트에 존재 → 벨 알림 클릭 시 공지 탭. 모바일 375px 하단 시트 스냅샷.

---

## 8. 구현 순서 (태스크)

1. **0040 마이그레이션 + SQL 테스트** — 표·RLS·RPC 6개·`NOTICE_POSTED` 3함수 재정의(0037 판 복사 + 1줄). TDD.
2. **API 클라이언트·타입** — `lib/api/notices.ts`·`types.ts`·단위 테스트, `database.types.ts` 재생성.
3. **라우트·탭·상태** — `MY_STUDY_TABS`·`TABS`·`state.ts`(noticeOpen/Edit/Unsaved·`blocksLeave`)·페이지 `?tab=notice`.
4. **NoticeTab 리스트·읽기** — 아코디언·`MarkdownView`·읽음 처리·빈 상태·종료 방.
5. **NoticeTab 작성/수정/삭제** — 인라인 폼·`MarkdownEditor`·RowMenu·상한 UI·이탈 가드.
6. **포커스 트랩 공용화** — `useFocusTrap` 추출, `ConfirmDialog` 무회귀.
7. **NoticePopup** — inbox·큐·dim+blur·확인/나중에·a11y·모바일 시트·reduced motion.
8. **탭 미읽음 점** — inbox·read 응답 연동.
9. **알림 링크 확인** — 벨 → `?tab=notice` 재마운트·열림 확인.
10. **E2E + 배포** — 0040 호스티드 적용, 마스터 계정 시나리오 검증.

의존: 1 → 2 → (3) → 4·6 병렬 → 5·7 → 8·9 → 10. 개요 탭 카드 작업과 겹치는 파일은 `MyStudyScreen.tsx`(탭 분기 1줄·팝업 마운트)·`StudyHeaderInfo.tsx` 뿐 — 그 작업 머지 후 착수.
