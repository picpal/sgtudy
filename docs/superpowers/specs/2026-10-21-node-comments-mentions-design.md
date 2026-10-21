# 회차·과제 댓글 + 멘션 설계

- 작성: 2026-10-21
- 요청(요지): 각 **회차(주차)·과제**에 참가자들이 **댓글**을 단다. 댓글에서 **사용자를 멘션**할 수 있다. 멘션되면 헤더 **알림(벨)** 에 "멘션되었다" 가 뜬다. 그 알림을 누르면 **해당 페이지의 해당 댓글 위치**로 이동한다.
- 마이그레이션: `0041_node_comments.sql` (0040 `room_notices` 다음. 다른 작업이 0041 을 먼저 쓰면 다음 번호)
- 범위: 설계만. 구현 전 D-list 확정 필요. 코드 변경 없음.

---

## 1. 현재 상태 (근거)

| 영역 | 지금 동작 | 근거 |
|---|---|---|
| 노드 | `goal_nodes` 한 표. 회차 = `depth 2`(`parent_id null`, `label`), 묶음 = 리프 아닌 하위, 과제 리프 = `task_type in (COMMON, DESIGNATED)`, 개인 목표 = `task_type = 'PERSONAL'`·`owner_id`(회차 바로 아래), 시험 = 리프 + `exams` 1행. `archived_at` 보관 | 0001 · 0014 · 0037 |
| 상세 화면 | `DetailView` 하나가 회차·묶음·과제·시험·개인 목표를 그린다(`kind` 분기, `DetailView.tsx:200`). 과제 본문 = `LeafBody`(설명 → `NodeAttachments` → `SubmissionSection` 또는 `ExamSection`). 회차 = 설명 → 첨부 → `PersonalSection` | `tabs/DetailView.tsx:465-468` · `tabs/LeafBody.tsx` |
| 상세 주소 | 보기 상세 = `?tab=curriculum&item={id}`(`viewSel`, 회차 포함 모든 노드). 알림 진입 = `?task={id}` → `goLeafPatch`(`viewFocus:"submission"`). 화면 key = `id:task:tab`(`page.tsx:47`) — 같은 key 면 재마운트 없음 | `state.ts` · `MyStudyScreen.tsx:75-90,260-280` |
| 딥링크 앵커 | `hashTarget.ts` — 벨이 `announceHash(link)`·`announceItem(link)` 후 `router.push`. 화면은 `useHashTarget(id, ready)` 로 **고정 id** 영역(#applications·#submissions·#leave-requests)에 스크롤+포커스 후 해시 제거. 새 화면 마운트 전 pending 8초 | `lib/hashTarget.ts` · `ui/NotificationBell.tsx:96-110` |
| 이탈 가드 | `screenKeyOf` 는 `tab`·`task` 만 본다. 해시 있는 알림 링크는 가드가 막지 않는다 | `lib/leaveGuard.ts:32-67` |
| 알림 | `notify_publish(kind, room, node, actor, recipients, dedupe_prefix, model)` — actor 제외, 수신자별 `dedupe_key = prefix:uid`(on conflict do nothing). **링크는 발행 시점에 `notify_link(kind, room, node, user)` 로 계산해 행에 저장** — 모델(model)을 받지 않으므로 댓글 id 를 링크에 넣을 통로가 없다. kind 추가 = `notification_kinds`·`notify_render`·`notify_link` 재정의(최신 **0040**). 벨은 60초 폴링 + visibilitychange | 0008 · 0040 · `NotificationBell.tsx` |
| 사람 | `profiles.nickname` 2~16자(한글·영문·숫자·`_`·`.`·**공백**), `nickname_normalized` UNIQUE. `person_json(uid)` = `{userId, nickname, tone}`. 클라이언트는 `curriculum.members`(그룹장·ACTIVE·INACTIVE, `role`·`status`) 를 이미 들고 있다 | 0001 · 0002 · `types.ts:211` |
| 마크다운 | 편집 = CodeMirror 6(`ui/markdown-editor`, `@codemirror/autocomplete` **미설치**). 표시 = 자체 파서(`my-study/markdown.ts` `parseInline`/`parseMarkdown`) → React 요소. HTML 주입 경로 없음 | `MarkdownView.tsx` · `package.json` |
| 권한·상태 | `room_readable` = 그룹장·ACTIVE·INACTIVE·PENDING·공개/초대. 공지(0040)는 열람을 그룹장+ACTIVE+INACTIVE 로 좁힘(`notice_reader_room`). 쓰기 가능 = `archived_at null ∧ status in (DRAFT,RECRUIT,ACTIVE)`(`notice_assert_editable` = 0011 과 같은 조건) | 0004 · 0011 · 0040 |
| 시험 노출 | 정답·해설은 출제자 설정(`reveal`: 제출 직후/마감 뒤) 전엔 어떤 경로로도 못 읽는다 | 0037 · 시험 스펙 §3.4 · D4 |
| 레이트 리밋 | 표 카운트 + `pg_advisory_xact_lock(hashtextextended('sgtudy.xxx:'||uid,0))` → `fail('RATE_LIMITED', …, {retryAfter…})` | 0032 `invite_code_lookup` · 0033 `api_rate_check` |
| 실시간 | Supabase Realtime 미사용. 갱신은 폴링·포커스 재조회(`useRefetchOnFocus`) | `MyStudyScreen.tsx` |
| 임시 저장 | 제출 작성 중 글은 `localStorage`(`submissionDraft.ts`, `sgtudy.subdraft.v1:{node}:{uid}`) | `submissionDraft.ts` |
| RLS 관행 | 새 표 = RLS on + `revoke all … from anon, authenticated` + 정책 없음 → 접근은 전부 `security definer set search_path=''` RPC, 내부 헬퍼는 GRANT 없음 | 0003 · 0040 |
| MCP | `api_invoke` 는 진행목표·개인 목표·시험 초안만(프로젝트 결정) | 0035 · 0038 |

**요약**: 댓글은 노드에 붙는 작은 도메인(표 1개 + RPC 4개 + 알림 kind 1개 + 상세 하단 섹션 1개). 어려운 곳은 셋 — ① 링크에 댓글 id 를 싣는 통로(`notify_link` 가 모델을 못 받음), ② 해시 앵커가 **고정 id** 만 지원, ③ 닉네임에 공백이 있어 `@텍스트` 만으로는 멘션 경계를 알 수 없음.

---

## 2. 목표 · 비목표

**목표**
1. 회차·과제(시험 포함) 보기 상세 하단에 「댓글」 섹션: 목록(오래된 → 최신), 작성, 내 댓글 수정·삭제.
2. `@` 입력 시 방 멤버 자동완성 → 멘션. 저장은 사용자 id, 표시는 읽을 때의 닉네임.
3. 멘션된 사람에게 벨 알림 `MENTIONED`. 누르면 그 노드 상세로 가서 해당 댓글로 스크롤 + 강조.

**비목표(v1)**: 대댓글(스레드), 반응(이모지), 첨부·이미지, 마크다운 블록, `@모두`, 실시간 푸시, 메일, 트리/보드 카드 댓글 수 배지(v1.1), 묶음·개인 목표 댓글(v1.1 — 구조는 열어 둠), MCP 노출, "내 과제에 댓글" 알림(v1.1).

---

## 3. 결정 사항 (D-list)

| # | 결정 | 선택지 | 권장 |
|---|---|---|---|
| D1 | 댓글 대상 노드 | A 회차 + 팀 과제 리프(시험 포함) · B A + 개인 목표 · C 모든 노드(묶음 포함) | **A** — 요청이 "주차·과제". 개인 목표는 "내 것" 성격, 묶음은 정리용 노드. DB 는 `comment_target_ok(node)` 한 함수로 판정해 B/C 확장이 함수 재정의 1회 |
| D2 | 열람 | A `room_readable` 전부 · B 그룹장+ACTIVE+INACTIVE · C 그룹장+ACTIVE | **B** — 공지(0040 D10)와 같은 범위. 공개 방 외부인·PENDING 은 못 봄(내부 대화). INACTIVE(이탈)는 기록 열람만 |
| D3 | 작성 | A 열람자 전부 · B 그룹장+ACTIVE | **B** — 이탈자가 계속 쓰는 건 이상. INACTIVE 에겐 입력창 대신 "이탈한 스터디에는 댓글을 쓸 수 없어요" |
| D4 | 시험 리프 스포일러 | A 제한 없음 · B 작성자에게 경고만 · C **잠금**: 보는 사람이 그 시험의 담당자 ∧ 미제출 ∧ 마감 전이면 목록·작성 모두 잠금 | **C** — 시험 스펙 "허용 전엔 어떤 경로로도 못 읽는다" 원칙. 서버가 `items` 대신 `locked:{reason:"exam"}` 반환, 화면은 "시험을 제출하면 댓글을 볼 수 있어요". 그룹장·편집자·제출자·마감 후는 정상. 시험 댓글 멘션 알림은 본문 발췌를 넣지 않는다(D13) |
| D5 | 스레드 | A 평면 · B 1단 답글 | **A 평면** + 각 댓글 [답글] = 입력창에 `@작성자 ` 를 넣고 포커스(멘션으로 알림이 간다). 1단 답글은 `parent_id` 열만 미리 둘지 → **두지 않음**(쓰지 않는 열은 계약 혼란). 필요 시 2단계에서 추가 |
| D6 | 본문 형식 | A 평문 · B 인라인 md 부분집합(굵게·기울임·취소선·`코드`·링크) · C 전체 md | **B** — 기존 `parseInline`/`Inline` 렌더러 재사용(안전, 추가 비용 ≈0). 블록(제목·표·목록)은 없음, 줄바꿈은 `<br>`. 입력은 평범한 `<textarea>`(CodeMirror 아님) — 모바일·IME·자동완성이 단순 |
| D7 | 길이·개수 상한 | — | **본문 1~2,000자**(멘션 토큰은 1자로 셈하지 않음 — 저장 길이로 4,000자 하드 상한), **멘션 ≤ 10명/댓글**, **노드당 댓글 1,000개** → `COMMENT_LIMIT` |
| D8 | 수정·삭제 | A 본인만 · B 본인 + 그룹장 삭제(중재) · C 그룹장 수정까지 | **B** — 그룹장은 남의 댓글 **삭제만**(수정 불가 = 말 바꾸기 방지). 수정 시 "수정됨" 표시(1분 유예, 공지와 같은 규칙) |
| D9 | 삭제 방식 | A 하드 · B 소프트(`deleted_at`, 본문 비움) | **B** — 행은 남기고 `body = ''`·`mention_ids = '{}'`. 목록에서 **숨김**(평면이라 자리표시자 불필요). 남겨 두는 이유: 딥링크가 "삭제됨" 과 "없음" 을 구분해 안내(D15). 삭제 시 그 댓글의 **안 읽은** `MENTIONED` 알림은 지운다 |
| D10 | 멘션 저장 | A 본문에 닉네임 텍스트 · B 본문에 토큰 `<@uuid>` + 서버가 사람 맵 동봉 · C 별도 표(오프셋) | **B** — 닉네임 변경·탈퇴에 안전, 렌더 시 `people[uid]` 로 `@닉네임` 칩. 서버는 토큰을 파싱해 `mention_ids uuid[]` 열도 채운다(수정 시 새로 멘션된 사람만 알림·삭제 시 알림 정리에 사용). 맵에 없는 uid(방과 무관) → `@알 수 없음` |
| D11 | 멘션 대상 | A 열람자 전부 · B 그룹장+ACTIVE · C 아무 사용자 | **B** — 알림을 받아 행동할 수 있는 사람만. 자동완성 후보도 같은 집합(`curriculum.members` 에서 `status=active`, 본인 포함 표시하되 알림 없음). 서버는 B 밖의 토큰을 **거부하지 않고** 저장하되 알림을 보내지 않는다(이탈 직전 작성 등 경합에서 저장 실패를 피함) |
| D12 | 자기 멘션 | — | 저장·표시는 허용, 알림 없음(`notify_publish` 가 actor 를 이미 뺀다) |
| D13 | 알림 종류 | A `MENTIONED` 만 · B + `COMMENT_ON_MY_TASK`(담당 과제 새 댓글) · C + 내 댓글 이후 새 댓글 | **A** — 요청 범위. B/C 는 알림 피로·설정 UI 필요 → v1.1 후보. 제목 `{작성자}님이 댓글에서 회원님을 언급했어요`, 본문 `「{노드}」 · {발췌 ≤ 80자, 토큰은 @닉네임으로}`(시험 리프는 발췌 없음). 방 이름은 기존처럼 메타 줄 |
| D14 | 알림 중복 | A 댓글×수신자 1건 · B 노드×수신자 묶음 | **A** — `dedupe = MENTIONED:{commentId}` → 같은 댓글에서 여러 번 불러도 1건, 수정으로 같은 사람을 다시 넣어도 재발행 없음, 수정으로 **새로** 넣은 사람만 1건. 연속 멘션 묶기(B)는 v1 생략(레이트 리밋 D18 로 상한) |
| D15 | 알림 링크 | A `?…&comment={cid}` 쿼리 · B **해시 `#comment-{cid}`** | **B** — 과제 리프 `/my-study/{slug}?task={node}#comment-{cid}`, 회차 `/my-study/{slug}?tab=curriculum&item={node}#comment-{cid}`. 해시는 화면 key·이탈 가드(`screenKeyOf`)·서버 prop 을 건드리지 않고, 기존 `announceHash` 경로를 그대로 탄다. 쿼리(A)는 page.tsx·screenKey·URL 동기화 세 곳을 바꿔야 함. **링크 통로**: `notify_link` 는 기본 경로만 돌려주고, `comment_notify` 가 `notify_publish` 직후 `update notifications set link = link || '#comment-' || cid where dedupe_key = any(이번 키들) and link not like '%#%'` 로 덧붙인다(`notify_publish` 시그니처 불변) |
| D16 | 도착 동작 | — | ① `?task=` 진입이라도 해시가 `comment-*` 면 `viewFocus` 를 `null`(제출 영역으로 끌려가지 않게). ② 댓글 목록을 `from={cid}` 로 불러 그 댓글이 반드시 포함되게(D17). ③ 준비되면 `#comment-{cid}` 로 `scrollIntoView({block:"center"})` + 포커스 + 2초 강조(배경 `mint-soft` → 투명, `prefers-reduced-motion` 이면 테두리만). ④ 해시 제거. **예외**: 삭제됨 → `#comments` 섹션으로 + 토스트 "삭제된 댓글이에요" · 없음/권한 없음 → 섹션으로 + "댓글을 찾을 수 없어요" · 시험 잠금 → 섹션(잠금 안내) |
| D17 | 정렬·페이지 | A 전체 · B 최신 50 + "이전 댓글 더 보기" | **B** — 오래된 → 최신(대화 순서), 처음엔 **최신 50개**, 위쪽 [이전 댓글 n개 더 보기](커서 `before={id}`). 딥링크는 `from={cid}` = 그 댓글부터 최신까지(상한 200, 넘으면 그 댓글 앞뒤 100) + `hasOlder` |
| D18 | 레이트 리밋 | — | **작성: 사용자당 1분 10개 · 1시간 120개**(방 무관, `node_comments` 카운트 + advisory 잠금) → `RATE_LIMITED`(`retryAfterSec`). 수정은 리밋 없음(알림은 새 멘션만이라 증폭 없음). `@모두` 없음 |
| D19 | 갱신 | A Realtime · B 폴링 · C 작성 후·포커스 복귀·딥링크 도착 시 재조회 | **C** — 코드베이스에 Realtime 없음. 섹션 하단 "새로 고침" 버튼 + `visibilitychange` visible 시 최신 페이지 재조회(마지막 조회 30초 이후만) |
| D20 | 종료·보관 방, 보관 노드 | A 계속 쓰기 · B 읽기 전용 | **B** — 쓰기 = 방 `archived_at null ∧ status in (DRAFT,RECRUIT,ACTIVE)` ∧ 노드 `archived_at null`. 수정·삭제도 동일(그룹장 삭제 포함 — 보관 = 동결). 아니면 입력창 대신 "종료된 스터디는 댓글을 쓸 수 없어요" |
| D21 | 노드 삭제 | — | `on delete cascade` — 댓글 함께 삭제. 이미 보낸 알림은 상세가 없는 id → 기존 동작(목록으로) + 토스트 없음 |
| D22 | 카드 댓글 수 배지 | A v1 포함(`curriculum_json` 재정의) · B v1.1 | **B** — `curriculum_json` 은 크고 자주 재정의되는 함수(충돌 위험). v1 은 상세 섹션 제목의 "댓글 n" 만. v1.1 에 별도 RPC `comment_counts(slug)` 로 보드·트리에 얹기 |
| D23 | MCP | A 노출 · B 비노출 | **B** — 프로젝트 결정(MCP = 진행목표·개인 목표·시험 초안) 유지 |
| D24 | 작성 중 글 보존 | A 이탈 가드 · B 로컬 임시 저장 | **B** — `localStorage` `sgtudy.cdraft.v1:{node}:{uid}`(본문 + 고른 멘션 목록). 이탈 가드(`blocksLeave`)에 넣지 않는다 — 댓글은 짧고 가드가 늘수록 화면 이동이 무거워짐. 등록 성공 시 삭제 |

---

## 4. 데이터 모델 (0041)

```sql
create table public.node_comments (
  id           bigint generated always as identity primary key,
  room_id      bigint not null references public.rooms(id) on delete cascade,
  node_id      bigint not null references public.goal_nodes(id) on delete cascade,
  author_id    uuid   references public.profiles(id) on delete set null,
  body         text   not null default '' check (char_length(body) <= 4000),  -- 토큰 포함 하드 상한. 1~2000(표시 길이)은 RPC 가 검사
  mention_ids  uuid[] not null default '{}',                                   -- 본문 토큰에서 뽑은 고유 uid(≤10). 알림 diff·정리용
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),   -- 본문이 바뀔 때만
  deleted_at   timestamptz,
  deleted_by   uuid references public.profiles(id) on delete set null,
  check ((deleted_at is null) or (body = '' and mention_ids = '{}'))
);
create index node_comments_node_idx   on public.node_comments (node_id, id) where deleted_at is null;
create index node_comments_author_idx on public.node_comments (author_id, created_at);   -- 레이트 리밋
alter table public.node_comments enable row level security;
revoke all on public.node_comments from anon, authenticated;   -- 정책 없음 = RPC 전용
```

- `room_id` 는 `node.room_id` 복사(방 단위 정리·리밋·검증 단축). 노드가 방을 옮기는 경로 없음.
- 멘션 토큰: `<@xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx>`(소문자 uuid). 정규식 `<@([0-9a-f-]{36})>`. 표시 길이 = 토큰을 1자로 본 길이.
- 별도 멘션 표는 두지 않는다(D10). "내가 멘션된 댓글 모아 보기" 가 필요해지면 그때 `node_comment_mentions` + GIN 인덱스.

## 5. RPC (전부 `security definer set search_path = ''`)

**내부 헬퍼 (GRANT 없음)**
| 함수 | 역할 |
|---|---|
| `comment_limits() → jsonb` | `{"bodyMax":2000,"mentionsMax":10,"perNode":1000,"perMinute":10,"perHour":120,"page":50}` |
| `comment_target_ok(n goal_nodes) → bool` | D1: `n.depth = 2 or n.task_type in ('COMMON','DESIGNATED')`(시험은 COMMON/DESIGNATED 리프) |
| `comment_reader(p_slug, p_node) → record(r rooms, n goal_nodes, role text)` | `notice_reader_room` 과 같은 순서(ROOM_NOT_FOUND → NOT_MEMBER(pending details)) + 노드가 그 방 소속 ∧ `comment_target_ok` 아니면 `NODE_NOT_FOUND` |
| `comment_exam_locked(n, uid) → bool` | D4: `exists exams(node)` ∧ 보는 사람이 담당자(`is_task_assignee`) ∧ 그 시험 미제출 ∧ `kst_today() <= n.end_date` ∧ 편집자 아님 |
| `comment_writable(r, n, uid) → text` | null = 가능, 아니면 이유 코드 `ended`·`archived_node`·`inactive`·`exam_locked` |
| `comment_parse(p_body) → (display_len int, ids uuid[])` | 토큰 추출·고유화·길이 계산 |
| `comment_people(p_room, ids uuid[]) → jsonb` | `{uid: person_json}` — **그 방의 그룹장 또는 room_members 행이 있는 사람만**(임의 uuid 로 닉네임 조회 방지) |
| `comment_json(c, p_viewer) → jsonb` | `{id, body, author: Person|null, createdAt, updatedAt, edited, mine, canEdit, canDelete}` |
| `comment_rate_check(uid)` | advisory 잠금 `sgtudy.comment:{uid}` + 1분/1시간 카운트(삭제 포함 — 쓰고 지우기 반복 방지) |
| `comment_notify(c, n, r, p_actor, p_new uuid[])` | 수신 = `p_new ∩ (그룹장 ∪ ACTIVE)`. `notify_publish('MENTIONED', room, node, actor, rcpt, 'MENTIONED:'||c.id, {commentId, excerpt|null})` → 이번 키들의 link 에 `#comment-{id}` 덧붙임(D15) |

**공개 RPC (`grant execute … to authenticated`)**
| RPC | 입력 → 출력 | 규칙 |
|---|---|---|
| `comment_list(p_slug text, p_node bigint, p_before bigint default null, p_from bigint default null)` | → `{items: Comment[], people: {uid: Person}, hasOlder, total, canWrite, writeBlock: null|'ended'|'inactive'|'archived_node'|'exam_locked', locked: null|{reason:'exam'}, target: null|{id, state:'ok'|'deleted'|'missing'}}` | 오래된→최신. 기본 최신 50. `before` = 그 id 이전 50. `from` = D17. 시험 잠금이면 `items=[]`·`total` 만 |
| `comment_create(p_slug, p_node, p_body text)` | → `{comment, people}` | 쓰기 가능(D3·D4·D20) → 리밋(D18) → 검증(1~2000, 멘션 ≤10, 노드당 1000) → insert → `comment_notify(new = ids)` |
| `comment_update(p_slug, p_id bigint, p_body text)` | → `{comment, people}` | 본인만(`NOT_AUTHOR`), 삭제된 댓글 `COMMENT_NOT_FOUND`. `updated_at` 은 본문이 바뀔 때만. 알림 = `new_ids − old_ids` 만 |
| `comment_delete(p_slug, p_id bigint)` | → void | 본인 또는 그룹장(D8). 소프트 삭제(D9) + `delete from notifications where dedupe_key like 'MENTIONED:'||id||':%' and read_at is null` |

에러 코드: 기존 `ROOM_NOT_FOUND`·`NOT_MEMBER`·`NODE_NOT_FOUND`·`ROOM_NOT_EDITABLE`·`VALIDATION_FAILED`·`RATE_LIMITED` + 신규 `COMMENT_NOT_FOUND`·`NOT_AUTHOR`·`COMMENT_LIMIT`·`COMMENT_LOCKED`(시험 잠금 상태 쓰기). 신규 코드는 `lib/api/errors.ts` 메시지 표에 추가.

**알림 kind 재정의 (원본 0040)**: `notification_kinds` + `'MENTIONED'` · `notify_render`:
`when 'MENTIONED' then format('%s님이 댓글에서 회원님을 언급했어요', v_actor)` / 본문 `format('「%s」', coalesce(v_label, v_node)) || coalesce(' · ' || nullif(p_model->>'excerpt',''), '')` · `notify_link`:
`when p_kind = 'MENTIONED' then '/my-study/'||r.slug|| coalesce('?task=' || (리프면 p_node), '?tab=curriculum&item=' || p_node)`(해시는 `comment_notify` 가 붙인다). `notify_enabled`(0024) 그대로 — 모르는 kind 는 true(방 설정으로 끌 수 없음 = 개인에게 직접 온 알림).

## 6. 클라이언트

### 6.1 API · 타입
- `lib/api/comments.ts`: `listComments(slug, node, {before?, from?})`·`createComment`·`updateComment`·`deleteComment`. 타입 `CommentDto`·`CommentPage` 를 `types.ts` 에.
- `lib/mention.ts`(순수, 테스트 대상): `tokenize(body) → (text|mention)[]`, `toTokens(text, picks: {uid,nickname}[])`, `toEditable(body, people)`, `displayLength(body)`, `activeQuery(text, caret) → {start, query}|null`.

### 6.2 딥링크 (`lib/hashTarget.ts`)
- 새 훅 `useHashPrefixTarget(prefix: "comment-", ready) → string | null` — `useHashTarget` 과 같은 pending/announce/해시 제거 규칙, 단 id 대신 접두사 매칭하고 **찾은 id** 를 돌려준다. `takePending` 을 접두사 버전으로 일반화.
- `MyStudyScreen`: 초기 해시(또는 announce)가 `comment-*` 면 `goLeafPatch` 뒤 `viewFocus: null`(D16①). 같은 화면 재클릭은 기존 `announceHash`/`announceItem` 로 충분(회차 = `?item=` 경로, 과제 = 같은 `task` key 면 announce, 다른 task 면 재마운트).

### 6.3 `CommentSection` (`tabs/CommentSection.tsx`)
- 위치: `DetailView` 의 회차 본문(`PersonalSection` 아래)·`LeafBody` 맨 아래. 슬롯 1줄씩만 추가(다른 작업과 충돌 최소). `id="comments"`, `<section aria-labelledby>` 제목 "댓글 {total}".
- 목록: `<ol>`, 각 `<li id="comment-{id}" tabIndex={-1}>` = 아바타(`Avatar` tone) · 닉네임 · 상대 시간(`relativeTime`, `title`=절대 시각) · "수정됨" · 본문(`Inline` + 멘션 칩 `<span class="text-mint font-semibold">@닉네임</span>`, 나를 멘션한 칩은 배경 강조) · `RowMenu`(수정·삭제, 권한별). 삭제는 `InlineConfirm`.
- 상단 `[이전 댓글 n개 더 보기]`, 하단 입력창. 빈 상태 "첫 댓글을 남겨 보세요".
- 입력창 `CommentComposer`: `<textarea>` 자동 높이(최대 8줄), 글자 수 `n/2000`(1800 넘으면 표시), [등록] / Cmd·Ctrl+Enter. Enter = 줄바꿈.

### 6.4 멘션 자동완성 (`MentionPicker`)
- 트리거: 캐럿 앞이 줄 시작 또는 공백 다음의 `@` + 공백 없는 질의(닉네임에 공백이 있어도 **고르기 전 검색어**는 첫 단어로 충분 — 공백을 치면 닫힘). 후보 = `curriculum.members` 중 `status=active`(그룹장 포함), 정규화(NFC·소문자) **접두 일치 우선 → 포함 일치**, 최대 6개, 본인은 맨 뒤 "(나)".
- 고르면 `@{닉네임} ` 삽입 + `picks` 에 `{uid, nickname}` 기록. 등록 시 `toTokens` 가 `picks` 의 `@닉네임` 을 **긴 닉네임부터** 토큰으로 바꾼다(닉네임 UNIQUE → 모호성 없음). 사용자가 글자를 지워 깨진 멘션은 평문이 된다. 수정 모드는 `toEditable` 로 토큰 → `@닉네임` + `picks` 복원.
- ARIA: textarea `role="combobox" aria-autocomplete="list" aria-expanded aria-controls aria-activedescendant`, 목록 `role="listbox"`/`option`. 기존 `ui/Listbox` 패턴 재사용.
- 키보드: ↑↓ 이동(순환), Enter·Tab 선택, Esc 닫기(입력 유지). 열려 있을 때 Cmd+Enter 는 선택 아님 → 등록.
- **IME(한글)**: `keydown` 에서 `e.nativeEvent.isComposing || e.keyCode === 229` 면 ↑↓/Enter/Tab/Esc 처리 안 함(조합 확정 Enter 가 선택·등록으로 새지 않게). 질의 계산은 `input` 이벤트 값(조합 중 글자 포함)으로 → "@ㅎ" "@하" 단계에서도 후보 갱신. `compositionend` 뒤 한 번 더 계산. Safari 의 compositionend→keydown(Enter) 순서 차이는 `isComposing`+229 이중 검사로 덮는다.
- 위치: 데스크톱 = 캐럿 근처가 아니라 **textarea 바로 위 고정 팝오버**(캐럿 좌표 계산 회피, 단순). 모바일 = 같은 자리, 가상 키보드 위.

### 6.5 문구 (앱 톤 "~해요")
| 상황 | 문구 |
|---|---|
| 빈 목록 | 첫 댓글을 남겨 보세요 |
| placeholder | 댓글을 남겨 주세요 · @로 멤버를 불러요 |
| 시험 잠금 | 시험을 제출하면 댓글을 볼 수 있어요 |
| 이탈(INACTIVE) | 이탈한 스터디에는 댓글을 쓸 수 없어요 |
| 종료·보관 | 종료된 스터디는 댓글을 쓸 수 없어요 |
| 딥링크 삭제됨 / 없음 | 삭제된 댓글이에요 / 댓글을 찾을 수 없어요 |
| 리밋 | 댓글을 너무 빨리 쓰고 있어요 · 잠시 후 다시 해 주세요 |
| 삭제 확인 | 이 댓글을 지울까요? (그룹장이 남의 댓글: "그룹장 권한으로 이 댓글을 지울까요?") |

### 6.6 모바일(390px)
- 섹션은 상세 본문 흐름 그대로(별도 시트 없음). 입력창은 **하단 고정 아님**(상세 페이지 스크롤 끝) — 고정 바는 iOS 키보드·기존 하단 요소와 충돌. 댓글 메뉴 단추 hit area 44px(`hit-area` 테스트 규칙). 긴 URL·닉네임 `[overflow-wrap:anywhere]`.

### 6.7 접근성
- 새 댓글 등록 후 포커스는 입력창 유지 + `aria-live="polite"` "댓글을 등록했어요". 딥링크 강조 시 대상 `li` 에 포커스(스크린리더가 내용 읽음). 멘션 칩은 텍스트 그대로 "@닉네임"(색만으로 구분 안 함 — `@` 접두). 삭제·수정 버튼 `aria-label="{닉네임}님 댓글 수정"`.

## 7. 보안 · 남용
- 표 직접 접근 불가(RLS + revoke). 모든 읽기는 `comment_reader` 가 방 권한·노드 소속·대상 유형을 확인.
- 시험 잠금은 서버가 판단(D4) — 클라이언트 숨김에 기대지 않는다. 알림 본문 발췌도 시험 리프는 비움.
- `comment_people` 은 방과 관계 있는 사람만 → 토큰에 임의 uuid 를 넣어 닉네임을 캐는 경로 차단.
- 본문은 React 텍스트/자체 파서로만 렌더 — HTML 주입 없음. 링크는 기존 `Inline` 의 `rel="noopener noreferrer nofollow"`.
- 알림 폭탄: 멘션 ≤10/댓글 × 10댓글/분 = 최대 100건/분/사용자, 같은 댓글 재발행 없음(D14). `@모두` 없음.
- 삭제 시 안 읽은 멘션 알림 정리(D9) — "지운 욕설이 알림으로 남는" 경로 차단(읽은 것은 이미 봤으므로 유지).

## 8. 테스트 계획
| 층 | 파일(예) | 핵심 |
|---|---|---|
| SQL (vitest + 로컬 DB, `supabase/tests/*-sql.test.ts`) | `comments-sql.test.ts` | 열람 매트릭스(그룹장·ACTIVE·INACTIVE·PENDING·외부인·익명), 작성 매트릭스, 대상 유형(회차·과제·시험 ○ / 묶음·개인 목표 ✕), 시험 잠금 4조합(담당·미제출·마감 전·편집자), 종료/보관 방·보관 노드, 길이·멘션 수·노드당 상한, 리밋(11번째 1분 내), 수정 본인만·그룹장 삭제, 소프트 삭제 후 목록 제외·`target.state`, 알림: 멘션 1회·중복 멘션 1건·자기 멘션 0·비멤버 0·INACTIVE 0·수정으로 추가된 사람만·삭제 시 안 읽은 알림 삭제, 링크 `#comment-{id}` 형식(리프 `?task=`, 회차 `?tab=curriculum&item=`), `comment_people` 이 무관한 uuid 를 내지 않음, `before`/`from` 페이지 |
| 순수 단위 | `lib/mention.test.ts` | 토큰화·역변환·긴 닉네임 우선·공백 닉네임·깨진 멘션 평문화·표시 길이·`activeQuery`(줄 시작, 공백 뒤, 이메일 `a@b` 무시) |
| DOM | `CommentSection.dom.test.ts`·`CommentComposer.dom.test.ts` | 목록·더 보기·권한별 메뉴·잠금/읽기 전용 문구, 자동완성 ↑↓/Enter/Tab/Esc, **IME 조합 중 Enter 무시**(`isComposing`·229), Cmd+Enter 등록, 임시 저장 복원 |
| DOM | `hashTarget.dom.test.ts` 확장 | 접두사 훅: 해시·pending·announce·해시 제거·다른 경로 무시 |
| DOM | `NotificationBell.dom.test.ts` 확장 | `#comment-` 링크 클릭 → `announceHash` + push |
| E2E (Playwright, 기존 스위트) | `comments.spec.ts` | A 가 과제에 B 멘션 → B 로그인 → 벨 → 클릭 → 해당 댓글 강조·포커스(데스크톱·390px), 회차 댓글 동일, 삭제된 댓글 링크 토스트 |

## 9. 구현 순서 (태스크)
| # | 태스크 | 의존 |
|---|---|---|
| T1 | `0041_node_comments.sql`: 표·헬퍼·RPC 4개·GRANT·`MENTIONED` kind(0040 판 재정의) | — |
| T2 | SQL 테스트 `comments-sql.test.ts` | T1 |
| T3 | `lib/mention.ts` + 단위 테스트 | — |
| T4 | `lib/api/comments.ts`·타입·에러 문구 | T1 |
| T5 | `hashTarget` 접두사 훅 + `MyStudyScreen` 의 `viewFocus` 예외(D16) | — |
| T6 | `CommentSection`(목록·페이지·메뉴·삭제·잠금/읽기 전용) | T3·T4 |
| T7 | `CommentComposer` + `MentionPicker`(IME·ARIA·임시 저장) | T3·T6 |
| T8 | `DetailView`·`LeafBody` 슬롯 연결 + 딥링크 스크롤·강조·예외 토스트 | T5·T6 (my-study 화면 다른 작업 머지 뒤) |
| T9 | DOM 테스트(섹션·컴포저·hashTarget·벨) | T5~T8 |
| T10 | E2E `comments.spec.ts` + 로컬 검증 | T8 |
| T11 | 호스티드 배포(0041) → 프로덕션 스모크(마스터 계정) | T2·T10 |

## 10. 위험 · 미확인
- **`notify_publish` 뒤 link UPDATE**(D15)는 "발행 함수 밖에서 행을 고친다" 는 예외 관행. 대안은 `notify_publish_ex(…, p_link_suffix)` 오버로드 신설(0008 시그니처 불변 유지) — 리뷰에서 선호를 정한다.
- `?task=` 진입의 `viewFocus:"submission"` 과 댓글 앵커 경합 — 상세 내부 포커스 로직이 동시 수정 중(다른 에이전트) → T8 은 그 작업 머지 뒤.
- 시험 잠금 판정의 "편집자" 정의가 시험 스펙(`exam_get` 노출 규칙)과 정확히 같아야 함 — 같은 헬퍼를 재사용할 수 있는지 T1 에서 확인.
- 회차 상세는 `?item=` 경로라 같은 화면 재클릭 시 `announceItem` → 화면이 상세를 다시 여는 타이밍과 해시 앵커 ready 타이밍이 겹친다 — `ready` = 댓글 목록 로드 완료로 정의해 해결.
