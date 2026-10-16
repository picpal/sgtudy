# 과제 상세 · 제출 (plan 06 §4.10) 설계

- 날짜: 2026-10-16
- 범위: 보기 모드 과제 상세(`DetailView` → `LeafBody`)의 `{/* plan 06: 제출 */}` 자리를 채운다 — 내 제출 카드(마크다운 본문·링크·파일 첨부), 담당자별 제출 현황(펼쳐 읽기), `?task=`·보드·캘린더·간트·일정·알림 진입 시 제출 영역 포커스.
- 원 설계: `docs/claude-design-prompt.md:176-185` (§4.10 과제 상세 + 제출).
- 넘겨받은 근거: `docs/superpowers/plans/2026-10-13-backend-05-frontend-integration.md:13-14, 3995` ("범위 밖 → plan 06: §4.10 … `task_get`/`file_register`/`submission_upsert`. 알림 `?task=` 는 리프 포커스까지만").
- 화면 틀: `docs/superpowers/specs/2026-10-15-goal-subtasks-design.md` §3.6(보기 상세, `?item=`), §3.9(390/820/1440·44px·안쪽 스크롤 금지).
- 연관 설계(병행): `docs/superpowers/specs/2026-10-16-personal-goals-design.md`(개인 과제 + "내 과제" 페이지) — §7 통합 지점 참고.

---

## 1. 지금 백엔드 계약 (근거)

### 1.1 RPC

| RPC | 시그니처 | 동작 요약 | 근거 |
|---|---|---|---|
| `task_get` | `(p_slug text, p_node bigint) → jsonb TaskDetail` | anon·authenticated. 방을 읽을 수 있으면 메타, `can_read_submissions` 면 제출물 목록. 비리프 → `NODE_NOT_LEAF` | `0007_submissions.sql:275-321, 325` |
| `submission_upsert` | `(p_node bigint, p_body text, p_links text[], p_file_ids uuid[]) → jsonb Submission` | authenticated. **처음 호출 = 제출**(초안 개념 없음). 이후 호출은 본문·링크·첨부만 교체 | `0007:84-165, 326` |
| `file_register` | `(p_node bigint, p_path text, p_name text, p_mime text, p_size bigint) → jsonb FileMeta` | Storage 에 직접 올린 뒤 호출 → `files` 행 READY | `0007:173-237, 327` |
| (없음) 파일 삭제 | — | 제출에서 빠진 첨부는 다음 `submission_upsert` 가 soft delete. Storage 객체는 SQL 이 지우지 않음 | `0007:148-149`, `0008:492-494` |

DTO (`docs/backend/03-api.md:200-206`, 빌더 `0007:24-40, 242-272`):

```ts
type TaskDetail = { today: string; node: NodeDto; path: { id; title; label }[];
  mySubmission: Submission | null; isAssignee: boolean; allSubmitted: boolean;
  submissions: (Submission & { author: Person })[] };
type Submission = { id; bodyMd; links: string[]; files: FileMeta[]; firstSubmittedAt; isLate; updatedAt };
type FileMeta = { id; name; contentType; size; status: "pending" | "ready" };   // object_path 는 없다
```

`task_get` 은 `today` 도 준다(`0007:314`) — 03-api 표에는 빠져 있으니 타입에 넣는다.

### 1.2 선행 검사 (`submission_target`, `0007:48-77`) — 제출·파일 등록 공통

순서와 오류 코드: 노드 없음 `NODE_NOT_FOUND` → 방 잠금(`room_lock`) → 존재 은닉 → 방이 ACTIVE·미보관 아님 `ROOM_NOT_ACTIVE`("진행중인 스터디에서만 제출할 수 있어요") → 보관(비리프 `PARENT_ARCHIVED` / 리프 `TASK_ARCHIVED`) → 비리프 `NODE_NOT_LEAF` → 담당자 아님 `TASK_NOT_ASSIGNED`.
`submission_upsert` 만 추가로 `today < start_date` → `TASK_NOT_STARTED {startDate}` (`0007:109-111`). **`file_register` 는 시작일을 보지 않는다** — UI 가 시작 전 업로드를 막아 고아 파일을 만들지 않는다.

### 1.3 제한값 (D10, `docs/backend/01-decisions.md:129-134`)

| 항목 | 값 | 오류 | 근거 |
|---|---|---|---|
| 본문 | ≤ 50,000자 (빈 문자열 허용) | `VALIDATION_FAILED {field:bodyMd}` | `0007:113-115` |
| 링크 | ≤ 20개, 각 `^https?://\S+$`, ≤ 2000자, 앞뒤 공백 trim | `INVALID_LINK {index}` / `{reason:count}` | `0007:116-125` |
| 첨부 | 제출당 ≤ 5개, 각 본인·이 리프·READY·Storage 실재 | `FILE_LIMIT_EXCEEDED` / `NOT_FOUND {fileId}` / `FILE_NOT_READY {fileId}` | `0007:126-136` |
| 파일 크기 | ≤ 10 MB (10,485,760 B, Storage 메타 우선) | `FILE_TOO_LARGE` | `0007:218-220`, 버킷 `0003_rls.sql:136-141` |
| MIME | png·jpeg·gif·webp·pdf·zip·x-zip-compressed·text/plain·text/markdown | `FILE_TYPE_NOT_ALLOWED` | `0007:11-15`, 버킷 `0003:137-139` |
| 업로드 중 묶음 | 제출 미연결·24시간 이내 PENDING/READY 가 이미 5개면 거부 | `FILE_LIMIT_EXCEEDED`("첨부는 과제당 5개까지예요") | `0007:222-226` |
| 키 | `{room_id}/{node_id}/{user_id}/{uuid}.{ext}` — ext 소문자 `[a-z0-9]{1,10}`(없어도 됨), 원본명은 키에 넣지 않음 | `VALIDATION_FAILED {field:path}` | `0007:168-169, 192-197`, `03-api.md:207` |
| 파일명 | 1~255자 | `VALIDATION_FAILED {field:name}` | `0007:198-200` |

### 1.4 지각·상태 규칙

- 마감 = `end_date` 다음날 00:00 KST(exclusive). `first_submitted_at ≥ 마감` → `is_late` (`0002_functions_core.sql:64-68`, `0007:140`).
- **마감이 지나도 제출할 수 있다**(지각 제출). 마감 확인 없음 — `submission_upsert` 에 종료일 검사가 없다(`0007:107-111`).
- `first_submitted_at`·`is_late` 는 처음 제출 때 고정, 이후 수정은 바꾸지 못한다(트리거 I9, `0002:138-148`; 테스트 `supabase/tests/submissions-sql.test.ts` 첫 케이스 "마감 뒤에 고쳐도 지각으로 바뀌지 않는다"). `updated_at` 은 갱신 트리거(`0002:134`).
- **수정 가능 기간 = 방이 ACTIVE·미보관이고 내가 담당자이고 과제가 보관 아님인 동안 무기한.** 방이 ENDED 가 되면 읽기 전용.
- **제출 취소(삭제) 없음** (D10 "삭제 없음").
- 사람별 코드 `task_code` (`0002:76-83`): 제출 있으면 `done`/`late`, 없으면 시작 전 `planned`, 종료일 지남 `missed`, 그 외 `open`. 화면 코드 `CODE_LABEL` = 기한내 제출 / 지각 제출 / 미제출 / 진행중 / 예정 (`src/components/my-study/model.ts:19`).

### 1.5 열람 권한 (RLS · RPC)

| 누가 | 메타·집계 | 사람별 상태(`node.task.people`) | 다른 사람 제출물(`submissions`) | 근거 |
|---|---|---|---|---|
| 그룹장 | ✓ | ✓ | ✓ 전부(보관 과제 포함) | `0003_rls.sql:27-32, 46-53`, `0007:251-254` |
| ACTIVE·INACTIVE(이탈) 멤버 | ✓ | ✓ | ✓ (보관 과제는 **본인 것만**) | 같음 |
| PENDING(승인 대기) | ✓ | ✓ | ✗ (`[]`) | `can_read_submissions` 는 ACTIVE·INACTIVE 만 |
| 공개 방 비멤버·비로그인 | ✓ | ✗ | ✗ | `0007:251` |

- 보관 리프는 `people` 가 `[]` (`0007:251`).
- `mySubmission` 은 담당 여부와 무관하게 내 행이 있으면 준다(`0007:301-303`) → 담당에서 빠졌거나 이탈한 사람도 자기 제출물을 본다.
- `submissions` 는 배정과 무관하게 그 리프의 모든 제출(`0007:305-311`) → **담당 해제된 사람의 제출도 섞여 온다.**
- Storage: 업로드 = 본인 폴더 ∧ `is_my_task`(담당자) ∧ room 세그먼트 일치, 읽기 = `can_read_submission`, 삭제 = 본인 폴더 (`0003:143-164`). 다운로드는 `createSignedUrl(path, 300)` (`03-api.md:198`).
- `files` 표 SELECT RLS: 내 것 ∨ 제출물을 읽을 수 있으면 (`0003:108-111`). 표 SELECT GRANT 는 남아 있다(0004:5 는 insert/update/delete/truncate 만 회수) → 어댑터가 `files.object_path`·`goal_nodes.room_id` 를 직접 읽을 수 있다(FileMeta 에 path 가 없어서 필요).

### 1.6 알림

- `TASK_ALL_SUBMITTED`: 처음 제출로 전원 제출이 되면 그룹장에게(완료 알림 방식 IMMEDIATE 일 때만, DAILY_DIGEST 면 다음날 `TASK_COMPLETION_DIGEST`) (`0007:152-162`, `0008:478-487`).
- 링크: `TASK_ALL_SUBMITTED`·`DEADLINE_REMINDER`·`TASK_ASSIGNED`·`TASK_UNASSIGNED` → `/my-study/{slug}?task={nodeId}` (`0008:61-71`, 0012 재정의 `0012_editor_notifications.sql:52`). 일정 화면 과제도 `?task=` (`src/components/schedule/calc.ts:31`).
- 지금 `?task=` 는 `goLeafPatch` 로 보기 상세를 연다(`src/components/my-study/state.ts:64`, `MyStudyScreen.tsx:41-57`).

### 1.7 백엔드 공백 하나 — 올렸다가 뺀 파일

화면에서 "빼기" 한 미연결 파일은 READY 로 24시간 남고(`0008:503-504` 가 24시간 뒤 정리) `file_register` 의 "업로드 중 묶음 5개" 계산(`0007:223-226`)에 계속 들어간다. 잘못 올린 파일을 몇 번 바꾸면 제출 전에 **하루 동안 더 못 올린다.** 클라이언트가 Storage 객체를 지워도 `files` 행은 그대로라 풀리지 않는다. → §5 판정 R9, 마이그레이션 **0015 `file_discard`**(작고 독립적). 번호 예약: 0013 = 백엔드 백로그, 0014 = 개인 과제, 0015 = 이 기능.

---

## 2. 화면 설계

### 2.1 배치 (과제 상세, 보기 모드 — 한 페이지 스크롤)

```
[← 진행목표] 1주차 IAM·VPC › 과제                         [편집]
[공통] IAM 정책 이해
10.01(목) – 10.03(토) · D-2                                ← 기존
설명 (MarkdownView)                                         ← 기존
┌ ✅ 모든 담당자가 제출했어요 ┐                              ← allSubmitted 일 때만
┌ 내 제출 ───────────────────────────── [상태 배지] ┐       ← 담당자 or mySubmission 있음
│ (작성 화면 또는 제출물 보기)                        │
└──────────────────────────────────────────────────┘
제출 현황 3/4                                                ← 기존 담당자 카드 격자를 대체
 ▸ 민수(그룹장) ✓ 기한내 제출 · 10.02 21:14
 ▸ 지은        ⏱ 지각 제출 · 10.04 09:02   [지각]
   철수(나)    ✓ 기한내 제출 · 10.02 08:00
   하나        ! 미제출
```

- 섹션은 내용만큼 자란다. 에디터는 `maxHeight="none"`, 안쪽 세로 스크롤러 금지.
- 폭: 상세 화면 폭 그대로. 390 에서는 카드 패딩 14px, 버튼 줄은 접혀 다음 줄로(각 44px).
- 데이터: 상세가 열리면 클라이언트가 `task_get(slug, nodeId)` 를 부른다. 그동안 제목·설명·기간은 커리큘럼 트리(이미 있음), 현황은 트리의 `people`(상태만, 펼침 없음)로 그리고 내 제출 카드는 스켈레톤.

### 2.2 내 제출 카드 — 상태와 문구

| 조건 (위에서부터 첫 일치) | 카드 내용 |
|---|---|
| 담당 아님 ∧ `mySubmission` 없음 | 카드 없음. 현황 위에 한 줄 "담당 과제가 아니에요 · 제출 현황만 볼 수 있어요" (그룹장이 과제를 안 하는 방이면 생략) |
| 담당 아님 ∧ `mySubmission` 있음 | 읽기 전용 제출물 + "담당에서 빠져 더 고칠 수 없어요 · 제출물은 남아 있어요" |
| 방 ENDED | 읽기 전용(있으면) / 없으면 "종료된 스터디라 제출할 수 없어요" |
| 방 DRAFT·RECRUIT | "스터디가 시작되면 제출할 수 있어요" |
| 과제 보관 | 읽기 전용(있으면) + "보관된 과제라 제출·수정할 수 없어요" |
| `today < startDate` | "{M.DD}({요일})부터 제출할 수 있어요" (작성 영역 숨김 — 시작 전 업로드 방지) |
| 제출 없음 | **작성 화면이 바로 열림** (시작 버튼 없음) |
| 제출 있음 | 제출물 보기 + [수정하기] |

상태 배지(카드 머리): 미제출(진행중 = 남색 "제출 전 · D-2", 마감 지남 = 빨강 "미제출 · 마감 지남"), "기한내 제출"(초록 체크), "지각 제출"(노랑 시계). 아이콘은 `StatusIcon` 재사용(색+모양).

제출물 보기 메타: "처음 제출 10.02(금) 21:14 · 마지막 수정 10.03(토) 08:10"(수정이 없으면 뒤 조각 생략, KST). 지각이면 "마감 뒤에 처음 제출해 지각으로 기록됐어요".

### 2.3 작성 화면

1. **본문** — 라벨 "제출 내용", `MarkdownEditor`(라이브 미리보기 CodeMirror, `maxHeight="none"`, `minHeight={240}`, placeholder "정리한 내용이나 회고를 적어 주세요"). 45,000자를 넘으면 "{n} / 50,000자" 표시, 넘으면 빨강·제출 비활성.
2. **링크** — 라벨 "링크 (선택)". `<input type="url" inputMode="url">` + [추가](44px). Enter 도 추가(IME 조합 중 Enter 무시). 목록 줄: 링크 텍스트(줄바꿈 허용) + [빼기](aria-label "{url} 빼기"). 오류: "http:// 또는 https:// 로 시작하는 주소만 넣을 수 있어요", "이미 넣은 링크예요", "링크는 20개까지예요".
3. **파일** — 라벨 "파일 (선택)". 드롭존 + [파일 고르기](44px, `<input type=file multiple accept=…>`). 안내 "PNG·JPG·GIF·WEBP·PDF·ZIP·TXT·MD · 파일당 10MB · 5개까지". 줄마다: 파일명 · 크기 · 상태(진행률 막대 `role=progressbar` + "올리는 중 42%" / "올림" / 오류 문구) · [취소|빼기|다시 시도]. 오류 문구: "10MB를 넘는 파일이에요", "올릴 수 없는 형식이에요", "첨부는 5개까지예요", "올리지 못했어요 · 다시 시도해 주세요".
4. **버튼 줄** — 왼쪽 안내 한 줄, 오른쪽 [취소](수정 중일 때만) [주 버튼].
   - 주 버튼: 처음·기한 안 "제출하기" / 처음·마감 지남 "지각 제출하기"(안내 "마감이 지나 지각으로 기록돼요") / 수정 "수정 저장".
   - 비활성 이유(버튼 옆 안내, `aria-describedby`): "내용·링크·파일 중 하나는 있어야 해요", "파일을 올리는 중이에요", "인터넷 연결을 확인해 주세요", "본문은 50,000자까지예요".
   - 수정 중 안내: "마감 뒤에 고쳐도 지각 여부는 처음 제출 시각으로 정해져요".
5. 진행 중: 주 버튼 "제출하는 중…" + 입력 잠금. 성공 토스트 "제출했어요" / "지각 제출했어요" / "수정했어요".

### 2.4 제출 현황

- 머리: "제출 현황 {sub}/{asg}" (h3, `tabIndex=-1` — 포커스 대상).
- 줄 = `node.task.people` 순서(배정순) + 그 사람의 `submissions` 항목. 그 뒤에 담당자가 아닌데 제출이 있는 사람(해제·이탈) 줄을 "담당 제외" 태그로 붙인다.
- 줄: 아바타 · 이름(+"(나)", 그룹장 👑 아님 — 기존 표기 따름) · `StatusIcon`+라벨 · 처음 제출 시각 · 지각이면 "지각" 배지. 제출물을 읽을 수 있는 줄은 버튼(`aria-expanded`, 44px) → 아래로 펼쳐 본문(MarkdownView)·링크·파일. 한 번에 여러 줄 펼칠 수 있다. 내 줄은 펼침 없음(위 카드에 있음).
- 읽을 수 없을 때: PENDING → 줄은 상태만 + 안내 "참가가 승인되면 다른 사람의 제출물을 볼 수 있어요". 보관 과제(people 비어 있음) → 그룹장은 `submissions` 로 줄을 만들고, 참가자는 "보관된 과제예요 · 제출물은 그룹장과 작성자만 볼 수 있어요".
- 담당자 0명: "아직 담당자가 없어요"(기존 문구 유지).
- 그룹장 화면도 같은 목록(전원 펼침 가능). 평가·코멘트·AI 튜터 피드백은 범위 밖 — 펼친 제출물 아래 여백만 둔다(원 설계 §4.10 마지막 줄).

### 2.5 파일 열기

파일 이름 = 버튼(44px 행). 누르면 어댑터가 `files.object_path` 를 읽고 `createSignedUrl(path, 300, { download: name })` → 새 탭. 실패 "파일을 열 수 없어요". 이미지 미리보기는 v1 범위 밖(판정 R11).

### 2.6 진입·포커스

- `goLeafPatch(id)` 가 `viewFocus: "submission"` 을 함께 싣는다 → 보드 카드·캘린더·간트·개요 "다음 마감"·알림/일정 `?task=` 모두 해당. 진행목표 목록 행 클릭·상세 안 경로 이동은 `viewFocus: null`(지금처럼 제목 h2).
- `task_get` 응답이 오면 대상 결정(`focusTargetOf`): **담당자이고 제출 가능하며 아직 미제출 → 내 제출 카드(머리 h3)**, 그 외 → 제출 현황 h3. `scrollIntoView({block:"start"})` + `focus({preventScroll:true})`. 한 번만(그 뒤 `viewFocus` 를 지운다).
- URL 은 지금 규칙 그대로(`?tab=curriculum&item=` — `?task=` 는 첫 화면 뒤 지운다, `editUrl.ts:16-29`). 포커스 상태는 URL 에 싣지 않는다(새로고침 = 제목 포커스).

### 2.7 저장 방식 — 확정 저장 + 이 기기 임시 저장

- **서버 저장은 낙관적이지 않다.** 처음 제출은 시각·지각이 영구 고정되는 행위라, 응답(Submission)으로만 화면을 바꾼다. 성공 후 `task_get` 재조회(현황·전원 제출) + 커리큘럼 재조회(보드·간트·개요의 사람별 코드).
- **임시 저장은 이 기기 localStorage**: 키 `sgtudy.subdraft.v1:{nodeId}:{userId}`, 값 `{ body, links, files: FileMeta[], at }`. 작성 중 500ms 디바운스로 쓰고, 제출 성공·[취소]·"버리기" 때 지운다. 모든 접근 try/catch(없어도 화면은 동작).
- 다시 열었을 때 임시본이 서버 값과 다르면 카드 위 안내 "이 기기에 저장하지 않은 작성 내용이 있어요 ({시각}) [이어 쓰기] [버리기]".
- 임시본의 파일은 24시간 뒤 서버가 정리할 수 있다 — 제출 때 `FILE_NOT_READY`/`NOT_FOUND {fileId}` 면 그 파일 줄을 "다시 올려 주세요" 오류로 바꾸고 나머지는 그대로 둔다.

### 2.8 미저장 가드

- 임시 저장이 본문·링크·올린 파일을 지키므로 **앱 안 이동(목록·경로·탭·뒤로 가기)은 막지 않는다.**
- 예외: **파일을 올리는 중**이면 상세의 [← 진행목표]·경로 버튼·Esc 가 막대 아래 `InlineConfirm` "파일을 올리는 중이에요 · 나가면 올리기가 취소돼요 [머무르기] [나가기]". 탭 전환·브라우저 뒤로 가기는 막지 않고 업로드를 취소한다(임시본에는 다 올린 파일만 남는다).
- `beforeunload`: 올리는 중이거나 임시 저장이 아직 안 써진(디바운스 대기) 동안만 등록.

---

## 3. 엣지 케이스

| 경우 | 기대 동작 |
|---|---|
| 담당 아님(공통 과제인데 그룹장이 과제를 안 함 / 지정 과제에서 빠짐) | 카드 없음, 안내 한 줄, 현황 열람 |
| 공통 vs 지정 | UI 차이 없음 — 판단은 `isAssignee` 하나. 유형 배지는 기존 |
| 개인 과제(병행 설계) | 내가 담당자로 배정돼 있으면 같은 카드. 별도 분기 없음(§7) |
| 작성 중 담당 해제·이탈 | 제출 때 `TASK_NOT_ASSIGNED` → 토스트(서버 문구) + 재조회 → 읽기 전용, 임시본 유지 |
| 작성 중 과제 보관 | `TASK_ARCHIVED` → 같은 처리 |
| 작성 중 방 종료 | `ROOM_NOT_ACTIVE` → 같은 처리 |
| 시작 전 | 작성 숨김, "{날짜}부터" (서버 `TASK_NOT_STARTED` 는 날짜가 바뀐 경계 대비 — 토스트 + 재조회) |
| 마감 지남 · 미제출 | 작성 열림, "지각 제출하기" |
| 마감 지남 · 제출됨 | [수정하기] 그대로, 지각 여부 불변 안내 |
| 빈 제출 | 서버는 허용하지만 UI 가 막는다(내용·링크·파일 중 하나) |
| 오프라인 | `navigator.onLine === false` → 주 버튼 비활성 + 안내. 요청 중 끊김 → 토스트 "제출하지 못했어요 · 연결을 확인하고 다시 눌러 주세요", 작성 내용 유지 |
| 업로드 실패 / 중간 취소 | 그 줄만 오류·제거, 다시 시도 가능. 다른 파일·본문 영향 없음 |
| 10MB 초과·형식 불가·6번째 | 올리기 전에 거절(그 줄 오류). 서버 오류가 와도 같은 문구 |
| 확장자 대문자·없음·이상한 이름 | 키 확장자는 소문자 `[a-z0-9]{1,10}` 만, 아니면 생략. 원본명은 `p_name` 으로 |
| `file.type` 이 빈 문자열(.md 등) | 확장자로 MIME 보완(md → text/markdown, txt → text/plain, zip → application/zip) |
| 빼기 | 저장된 제출에 붙은 파일 → 목록에서만 빼고 다음 저장 때 서버가 soft delete. 미연결 파일 → `file_discard`(0015)로 즉시 정리. 클라이언트는 Storage 객체를 지우지 않는다 |
| 같은 링크 두 번 | 막음 "이미 넣은 링크예요" |
| 두 기기 동시 수정 | 마지막 저장이 이긴다(서버가 전부 교체). 저장 뒤 재조회로 화면 갱신. 충돌 감지는 범위 밖 |
| 주 버튼 연타 | busy ref 로 한 번만 |
| 세션 만료 | `AUTH_REQUIRED` → 로그인(`routes.login(현재 주소)`) — 임시본이 남아 돌아오면 이어 쓰기 |
| `task_get` 실패 | 카드 자리에 "제출 정보를 불러오지 못했어요 [다시 시도]", 현황은 트리 값으로 |
| PENDING 이 상세를 봄 | 카드 없음(담당 아님), 현황은 상태만 |
| 보관 과제 + 그룹장 | 현황을 `submissions` 로 그림, 작성 불가 |
| 긴 본문·많은 링크 | 섹션이 내용만큼 자람, 페이지 스크롤 |

---

## 4. 수용 기준

1. 진행중 방에서 담당 과제 상세를 열면 미제출일 때 작성 화면이 바로 보이고, 본문·링크·파일을 넣고 "제출하기" 하면 카드가 제출물 보기로 바뀌고 배지 "기한내 제출", 현황·보드·간트의 내 상태가 같은 값으로 바뀐다.
2. 마감이 지난 미제출 과제는 "지각 제출하기" 로 제출되고 "지각 제출" 로 표시된다. 제출 후 수정해도 지각 여부·처음 제출 시각은 그대로, "마지막 수정" 시각만 바뀐다.
3. 파일은 진행률이 보이며 올라가고, 10MB 초과·불가 형식·6번째 파일은 올리기 전에 해당 문구로 거절된다. 올리는 중엔 제출할 수 없다.
4. 빼기 → 다시 올리기를 5번 넘게 해도(0015 적용 시) `FILE_LIMIT_EXCEEDED` 가 나지 않는다.
5. 담당이 아닌 사람은 작성 영역 없이 "담당 과제가 아니에요" 와 현황을 본다. ACTIVE 멤버·그룹장은 다른 사람 줄을 펼쳐 본문·링크·파일을 볼 수 있고, 승인 대기자는 상태만 본다.
6. 방이 종료됐거나 과제가 보관됐거나 시작 전이면 작성할 수 없고 해당 문구가 보인다.
7. 알림·일정 `?task=`, 보드·캘린더·간트·개요에서 과제를 열면 상세가 열리고 화면이 제출 영역(미제출 담당자 = 내 제출, 그 외 = 제출 현황)으로 스크롤·포커스된다. 목록 행 클릭은 제목 포커스.
8. 작성 중 새로고침해도 "저장하지 않은 작성 내용" 으로 이어 쓸 수 있다. 업로드 중 [← 진행목표] 는 확인을 묻는다.
9. 390/820/1440 에서 가로 스크롤 없음, 안쪽 세로 스크롤러 없음, 새 버튼 누르는 자리 ≥ 44px, 상태는 색+모양.
10. `npm run lint && npx tsc --noEmit && npx vitest run` 통과, 0015 를 넣으면 `npm run test:db` 통과.

---

## 5. 판정 기록

| # | 판정 | 이유 |
|---|---|---|
| R1 | 제출 영역은 과제 상세(보기 모드) 안, 설명 아래. 별도 라우트·모달 없음 | §3.6 의 `?item=` 규칙(뒤로·새로고침·공유)을 그대로 쓴다 |
| R2 | 기존 담당자 카드 격자는 "제출 현황" 목록으로 대체 | 같은 정보(사람·상태)를 두 번 보여 주지 않는다. 원 설계 §4.10 "담당자 리스트 → 클릭 시 펼쳐보기" |
| R3 | 서버 초안 없음. 첫 `submission_upsert` = 제출, 임시본은 localStorage | 백엔드에 초안 개념이 없고(`0007:139-142`) 만들면 지각 판정 시점이 모호해진다 |
| R4 | 서버 저장은 확정형(응답으로만 갱신) | 처음 제출은 되돌릴 수 없는 시각·지각 고정 |
| R5 | 빈 제출은 UI 에서 막고 백엔드는 그대로 | 백엔드 변경 최소화. 서버를 우회하는 빈 제출은 해악이 작다 |
| R6 | 다른 참가자 제출물은 펼쳐서 읽기 허용 | D10(`01-decisions.md:134`)·RLS 가 이미 허용, 원 설계 §4.10 이 요구 |
| R7 | 업로드는 `XMLHttpRequest` 로 Storage REST(`POST /storage/v1/object/attachments/{key}`) 직접 — 진행률 때문. 새 의존성 없음 | supabase-js `upload` 는 진행률이 없고 10MB 상한이라 TUS 불필요 |
| R8 | `room_id` 는 `goal_nodes.room_id` 표 읽기, 파일 경로는 `files.object_path` 표 읽기(RLS) | DTO 에 없고, 백엔드 변경 없이 RLS 로 안전하게 읽힌다 |
| R9 | 0015 `file_discard(p_file uuid)` 추가(사용자 결정 D1) | §1.7 — 빼기한 파일이 하루 동안 업로드 한도를 막는다 |
| R10 | 앱 안 이동은 막지 않고 업로드 중일 때만 상세 나가기 확인 | 임시본이 손실을 막는다. 편집 화면의 `leave` 기계를 보기 모드로 끌어오지 않는다 |
| R11 | 이미지 썸네일·인라인 미리보기는 v1 제외 | 서명 URL 300초·목록마다 요청 비용. 파일 열기로 충분 |
| R12 | 포커스는 `goLeafPatch` 진입에만, 대상은 `focusTargetOf` | 링크로 온 사람의 목적은 제출(담당자) 또는 현황 확인(그룹장) |
| R13 | 클라이언트는 Storage 객체를 지우지 않는다 | 저장된 제출에 붙은 파일을 지우면 다음 저장이 `FILE_NOT_READY`. 정리는 서버 잡/2단계 Edge Function |

## 6. 사용자 결정

- **D1 — 0015 `file_discard` 넣을까?** (권장: 예.) 아니면 §1.7 한계를 그대로 두고 `FILE_LIMIT_EXCEEDED` 때 "오늘 올렸다 뺀 파일이 많아 더 올릴 수 없어요 · 내일 다시 시도하거나 지금 목록으로 제출해 주세요" 를 보인다. 예라면 호스티드 적용(`supabase db push`)은 사용자가 승인 후 실행.
- **D2 — 참가자끼리 제출물 열람**: 백엔드가 이미 허용(R6). 그룹장만 보게 하려면 RLS·`task_get` 을 바꾸는 별도 마이그레이션이 필요하다. 기본값 = 허용.

## 7. 통합 지점 — 개인 과제 · "내 과제" 페이지 (`2026-10-16-personal-goals-design.md`)

- 제출 가능 여부는 **`task_assignments` 에 내 유효 배정이 있는 리프인가**(`is_task_assignee`) 하나로 정해진다(`0007:73`, Storage `0003:151`). 개인 과제가 리프 노드 + 소유자 배정 행으로 만들어지면 이 설계의 카드·업로드·현황이 그대로 동작한다. 개인 과제가 다른 표나 비리프로 모델링되면 `submission_target` 을 0014 쪽에서 확장해야 한다 — 그 설계에 "개인 과제 = `task_type` 이 있는 리프 + 소유자 배정" 을 요청한다.
- 개인 과제를 남이 볼지(현황·제출물 공개 범위)는 0014 의 RLS 가 정한다. 이 화면은 `task_get` 이 주는 `people`·`submissions` 를 그대로 그리므로 별도 분기 없음.
- "내 과제" 페이지 → 과제 상세 진입은 `/my-study/{slug}?task={nodeId}` 링크로 한다. 그러면 `goLeafPatch` → `viewFocus: "submission"` 으로 내 제출 카드에 바로 포커스된다(§2.6). 그 페이지가 상태 배지를 보여 주려면 같은 `task_code` 값을 쓰고, 순수 함수 `myCardStateOf`(플랜 Task 2)를 재사용할 수 있다.
- 번호: 0014 = 개인 과제, 0015 = 이 기능(`file_discard`만). 0015 는 0014 에 의존하지 않는다.
