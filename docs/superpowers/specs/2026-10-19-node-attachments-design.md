# 진행목표 항목 첨부 파일 (회차·묶음·과제·개인 목표) — 설계

- 작성 2026-10-19 · 상태: **확정**(2026-10-19 사용자 승인 — §11 D1~D7 추천안 그대로, D7 = 이 기능 먼저 배포)
- 플랜: `docs/superpowers/plans/2026-10-19-node-attachments.md`
- 마이그레이션: **`0030_node_attachments.sql`** (AI 연동은 그 뒤 0031–0033 — §10)

## 1. 배경 · 문제

진행목표 항목(회차·묶음·공통 과제·지정 과제·개인 목표)의 **설명**은 마크다운 글만 쓸 수 있다. 강의 자료 PDF, 실습 템플릿 ZIP, 참고 이미지 같은 파일을 붙일 곳이 없어 외부 드라이브 링크로 우회한다. 제출(submission)에는 이미 첨부가 있다(0007·0015·0019) — 같은 인프라를 항목 설명에도 쓴다.

## 2. 목표 / 비목표

| 목표 | 비목표 (v1) |
|---|---|
| 다섯 종류 항목 모두 편집 화면에서 파일 추가·빼기, 저장 버튼 한 번으로 확정 | 마크다운 본문 안 인라인 이미지(`![](…)`) — §11 D2 |
| 보기 상세에서 첨부 목록 + 내려받기(서명 URL) | 트리 행·보드·간트 카드의 📎 개수 표시(`curriculum_json` 재정의 필요) |
| 제출 첨부와 같은 제한·형식·업로드 UI·정리 크론 재사용 | 첨부 변경 알림(§8) |
| 노드 삭제·방 삭제 경로 어디서든 첨부가 고아로 남지 않음 | 파일 미리보기(이미지 썸네일·PDF 뷰어) |
| | AI 연동(MCP)에서 첨부 읽기·쓰기(§9) |
| | 방 공개 페이지(`/rooms/[slug]` 외부인)에서 내려받기 — §11 D3 |

## 3. 현재 구조 (재사용 지점)

| 무엇 | 위치 | 이번에 쓰는 방식 |
|---|---|---|
| `files` 표: `node_id`·`purpose`(ATTACHMENT\|COVER)·`status`(PENDING\|READY\|DELETED) | `0001_schema.sql:145-161` | 새 purpose **`NODE_DOC`** + 새 열 `attached_at` (§6.1) |
| 버킷 `attachments`(private, 10MB, MIME 9종) | `0003_rls.sql:135-141` | 그대로. 키 접두사 `n/` 로 제출 키와 분리 |
| Storage 정책 3개(키 `^[0-9]+/[0-9]+/{uuid}/…` 고정) | `0003_rls.sql:143-163` | 기존 정규식에 `n/…` 가 안 맞는다 → 기존 정책이 새 키에 적용되지 않음. 새 정책 2개 추가 |
| `file_register`(경로·이름·MIME·크기·Storage 실재·유예 규칙) | `0007:173-237` → `0019` 재정의 | 같은 검증 순서를 `node_file_register` 로 복제(서로 다른 권한·키) |
| `file_discard`(미연결 첨부를 한도에서 빼기) | `0015` | `purpose='ATTACHMENT'` 만 → `node_file_discard` 별도 |
| `job_cleanup`(PENDING 1h · 미연결 ATTACHMENT 24h → DELETED) | `0008:494-511` | 재정의: 미저장 NODE_DOC 24h · 노드 잃은 NODE_DOC → DELETED 추가 |
| `file_purge_grace`·`file_purge_candidates`·Edge Function `cleanup-files` | `0019`, `supabase/functions/cleanup-files` | **변경 없음** — purpose 무관하게 DELETED 를 Storage 에서 지운다 |
| 업로드 큐·진행률 REST 업로드·리듀서 | `src/lib/api/upload.ts`, `src/components/my-study/uploads.ts`, `useSubmissionComposer.ts` | `uploadAttachment`·`uploadsReducer`·`checkFile` 재사용, 큐는 새 훅 |
| 업로드 UI | `tabs/FileUploadList.tsx` | 라벨·안내 문구 prop 화 후 재사용 |
| 서명 URL | `src/lib/api/submission.ts` `fileUrl`(files RLS → object_path → 300초) | 그대로 재사용(정책만 열어 주면 동작) |
| 팀 노드 편집 권한 | `require_curriculum_editor`·`node_assert_editable`(0011) | 같은 판정 |
| 개인 목표 권한 | `personal_eligible`·`personal_viewer`·`personal_room`(0014), 그룹장 = 보관·삭제만(스펙 R4) | 그룹장 = **빼기만**(모더레이션) |

## 4. UX

### 4.1 편집 화면

| 항목 | 화면 | 자리 |
|---|---|---|
| 회차·묶음·공통·지정 과제 | `EditView`(진행목표 편집 `?item=`) | **설명 편집기 바로 아래** "첨부 파일 (선택)" |
| 개인 목표 | `PersonalForm`(상세 안 펼침 폼) | 설명 편집기 아래, [저장]/[취소] 위 |

- 구성: 기존 `FileUploadList` 그대로 — 드롭존 + [파일 고르기] · 안내 "PNG·JPG·GIF·WEBP·PDF·ZIP·TXT·MD · 파일당 10MB · 5개까지" · 줄마다 이름/크기/진행률/[취소|빼기|다시 시도].
- **저장 모델**: 파일은 고르는 즉시 Storage 에 올라가고 서버에 "업로드됨(미저장)"으로 등록된다. 항목에 붙는 것은 **[저장]** 을 눌렀을 때(`node_files_set`). 저장하지 않고 떠나면 기존 "저장하지 않은 수정이 있어요" 확인이 뜬다(첨부 변경도 미저장 수정으로 센다). 버리면 올린 파일은 24시간 뒤 정리된다.
- 올리는 중에는 [저장] 비활성 + 안내 "파일을 올리는 중이에요" (제출 작성과 같은 규칙).
- 방금 만든 임시 행(`n.temp`)은 서버 id 가 없어 드롭존 비활성 + 안내 "저장한 뒤 파일을 붙일 수 있어요".
- 방이 ENDED·보관이거나 항목이 보관 중이면 편집 자체가 막혀 있으므로 별도 처리 없음.

### 4.2 보기 상세

| 항목 | 화면 | 자리 |
|---|---|---|
| 회차·묶음 | `DetailView` 부모 블록 | 설명(`MarkdownView`) 바로 아래, 하위 목록(`ChildList`) 위 |
| 공통·지정 과제, 개인 목표 | `LeafBody` | 설명 아래, 제출 영역(`SubmissionSection`) 위 |

- 제목 "첨부 파일 n" + 목록. 줄 = 파일 아이콘(형식별 글자 배지: PDF/ZIP/IMG/TXT) · 이름(`overflow-wrap:anywhere`) · 크기 · [받기] 버튼(`h-11`, `aria-label="{파일명} 받기"`).
- [받기] = `fileUrl()` 300초 서명 URL(`download` = 원본 이름) → 새 창이 아닌 같은 탭 다운로드. 실패 토스트 "파일을 열 수 없어요".
- 첨부 0개면 영역 자체를 그리지 않는다. 볼 권한이 없으면(서버 `NODE_NOT_FOUND`) 조용히 숨긴다.
- 그룹장이 남의 개인 목표 상세를 볼 때: 줄마다 [빼기] 추가(인라인 확인 "이 파일을 목표에서 뺄까요? 팀원에게는 알리지 않아요") → `node_files_set` 즉시 호출.

### 4.3 모바일 390

- `FileUploadList` 는 이미 `flex-wrap`·44px 버튼 — 그대로. 목록 줄은 이름이 한 줄을 다 쓰고 크기·[받기]가 다음 줄로 내려간다(`flex-[1_1_180px]`).
- 가로 스크롤 없음, 새 안쪽 스크롤러 없음(한 페이지 스크롤 규칙). 확인 폭 390 / 820 / 1440.

## 5. 권한

### 5.1 추가·빼기 (쓰기)

| 항목 | 누가 | 방 상태 | 항목 상태 |
|---|---|---|---|
| 팀 항목(회차·묶음·공통·지정) | 그룹장 + 위임 편집자(`can_edit_curriculum`) — 다른 편집자가 올린 파일도 뺄 수 있다(항목 단위 소유) | DRAFT·RECRUIT·ACTIVE, 미보관(`node_assert_editable` 과 같음) | 보관 아님(보관 리프 `TASK_ARCHIVED`, 보관 부모 `PARENT_ARCHIVED`) |
| 개인 목표 — 소유자 | 소유자 ∧ 소유 자격(`personal_eligible`: 그룹장 \| ACTIVE) | RECRUIT·ACTIVE, 미보관(`personal_room` 과 같음) | 보관 아님 |
| 개인 목표 — 그룹장(남의 것) | **빼기만**(모더레이션, 스펙 personal-goals R4 와 같은 결) | 위와 같음 | 보관 아님 |
| 위임 편집자(남의 개인 목표) | 불가(`NOT_OWNER`) | | |

- 미저장 업로드를 항목에 붙이는 것은 **올린 본인만**(다른 편집자의 미저장 파일 id 로 붙이기 → `FILE_NOT_READY`).
- 오류 코드: `NODE_NOT_FOUND`(존재 은닉) · `ROOM_NOT_FOUND` · `NOT_CURRICULUM_EDITOR` · `NOT_OWNER` · `ROOM_NOT_EDITABLE` · `TASK_ARCHIVED`/`PARENT_ARCHIVED` · `FILE_LIMIT_EXCEEDED` · `FILE_NOT_READY` · `FILE_TYPE_NOT_ALLOWED` · `FILE_TOO_LARGE` · `VALIDATION_FAILED`.

### 5.2 보기·내려받기 (읽기)

| 항목 | 볼 수 있는 사람 |
|---|---|
| 팀 항목, 보관 아님 | 그룹장 + 멤버 ACTIVE·INACTIVE (**PENDING 신청자 제외** — 오케스트레이터 판정 2026-10-19: D3 "멤버 전용"에 맞춤. `is_room_member` 대신 상태를 좁힌 검사 사용) |
| 팀 항목, 보관 | 그룹장·위임 편집자(보관 항목을 다루는 사람) |
| 개인 목표, 보관 아님 | 소유자 + `personal_viewer`(그룹장·ACTIVE·INACTIVE) — 개인 목표 열람 범위와 같음 |
| 개인 목표, 보관 | 소유자 + 그룹장 |
| 공개 방 외부인·비로그인 | 불가(설명 글은 보여도 파일은 멤버 전용 — §11 D3) |

- 판정은 SQL 한 곳 `node_doc_readable(node, uid)`. 이것을 `files_select` RLS·Storage SELECT 정책·`node_files` RPC 가 같이 쓴다.
- 내려받기는 항상 서명 URL(300초). 버킷은 private 유지.

## 6. 데이터 · 서버

### 6.1 스키마 (추가형)

- `files.purpose` 에 값 **`NODE_DOC`** (VARCHAR(12) 안). 제출 첨부(`ATTACHMENT`)와 섞이지 않게 별도 값 — `job_cleanup` 의 미연결 ATTACHMENT 24h 규칙·`file_discard`·`submission_upsert` 가 NODE_DOC 를 건드리지 않는다.
- `files.attached_at timestamptz null` — 항목에 저장된 시각. `null` = 올렸지만 아직 저장 전(제출의 `submission_id is null` 과 같은 역할).
  - 왜 `PENDING` 을 쓰지 않나: `job_cleanup` 이 PENDING 1시간을 purpose 무관하게 DELETED 로 바꾼다(0008:499-500). 설명을 길게 쓰는 편집 세션이 1시간을 넘길 수 있다. → 업로드 검증이 끝나면 READY(제출과 같음), "붙었나"는 `attached_at` 으로 구분.
- 인덱스 `ix_files_node_doc (node_id) where purpose='NODE_DOC' and status='READY'`.
- Storage 키: **`n/{room_id}/{node_id}/{uuid}.{ext}`** — 업로더 세그먼트 없음(항목 단위 소유). 기존 정책 정규식(`^[0-9]+/…`)과 겹치지 않는다.

### 6.2 RPC (모두 `security definer set search_path=''`, 실패는 `public.fail`)

| 함수 | 인자 | 반환 | 하는 일 |
|---|---|---|---|
| `node_file_register` | `(p_node bigint, p_path text, p_name text, p_mime text, p_size bigint)` | FileMeta | 쓰기 권한(§5.1 추가) → 키 형식 → 이름 1~255 → MIME 화이트리스트 → Storage 실재·metadata 크기/MIME → 10MB → 유예 지난 DELETED 되살리기 금지(0019) → 한도(붙은 것 + 내 미저장 24h ≥ 5 → `FILE_LIMIT_EXCEEDED`) → `files` READY, `attached_at null` |
| `node_files_set` | `(p_node bigint, p_file_ids uuid[])` | FileMeta[] | 항목의 첨부를 **목록대로** 만든다(집합 의미, 멱등). 중복 id 거부 · 5개 초과 거부 · 새로 붙일 id = 내 미저장 READY ∧ 같은 항목 ∧ Storage 실재 · 빠진 붙은 파일 → DELETED. 목록이 현재의 부분집합이면 "빼기만"(개인 목표 그룹장 허용) |
| `node_file_discard` | `(p_file uuid)` | `{id,status:'deleted'}` | 내 미저장 NODE_DOC → DELETED(한도에서 뺀다, 0015 와 같은 이유). 붙은 파일 → `FILE_ATTACHED` |
| `node_files` | `(p_node bigint)` | FileMeta[] | 읽기 권한이면 붙은 READY 목록(`attached_at, created_at, id` 순), 아니면 `NODE_NOT_FOUND` |

내부(GRANT 없음): `node_doc_readable(bigint, uuid)`, `node_doc_writable(bigint, uuid)`, `node_doc_target(bigint, uuid, boolean)`, `node_doc_key_ok(text)`, `node_files_json(bigint)`.
정책용 1인자 래퍼(GRANT): `node_doc_object_writable(text)`(authenticated), `node_doc_object_readable(text)`(authenticated), `node_doc_readable_me(bigint)`(anon·authenticated — `files_select` 가 anon 질의에도 평가되므로).

### 6.3 RLS · Storage 정책

- `storage.objects` INSERT 정책 **`attachments_insert_node_doc`**: `bucket_id='attachments' and node_doc_object_writable(name)` — 함수 안에서 정규식을 먼저 보고 캐스트(AND 평가 순서에 기대지 않는다).
- `storage.objects` SELECT 정책 **`attachments_select_node_doc`**: `node_doc_object_readable(name)` = 키 형식 ∧ 그 경로의 files 행이 NODE_DOC·READY·`attached_at` 있음 ∧ `node_doc_readable`. 미저장 객체는 아무도 서명할 수 없다(올린 사람도 — 필요 없음).
- DELETE 정책 없음 — 클라이언트는 Storage 객체를 지우지 않는다(기존 R13). `attachments_delete_own` 은 키 정규식이 달라 `n/…` 에 안 맞는다.
- `files_select` 재생성: 세 번째 갈래를 `purpose='ATTACHMENT'` 로 좁히고(기존 COVER 행은 node_id 가 없어 동작 동일) NODE_DOC 갈래 추가 `purpose='NODE_DOC' and status='READY' and attached_at is not null and node_doc_readable_me(node_id)`. 업로더 본인 갈래(`owner_user_id = me`)는 그대로.

### 6.4 생애주기

| 사건 | 처리 |
|---|---|
| 파일 고름 | 클라이언트 → Storage REST 업로드(`n/…`) → `node_file_register` → READY·미저장 |
| [저장] | `node_files_set` → 새 파일 `attached_at=now()`, 빠진 파일 DELETED |
| 저장 전 [빼기] | 올리는 중 = abort, 미저장 READY = `node_file_discard`(best effort), 저장된 파일 = 목록에서만(다음 저장이 DELETED) — 제출의 `removePlanOf` 와 같은 의미 |
| 저장 안 하고 떠남 | 미저장 READY 24h 뒤 `job_cleanup` 이 DELETED |
| 항목 보관/해제 | 파일 그대로(읽기 범위만 §5.2 로 좁아짐). 해제하면 다시 보인다 |
| 항목 삭제(`node_delete` 서브트리, `personal_delete`, 방 삭제 cascade, AI 플랜의 일괄 적용 포함) | **`goal_nodes` BEFORE DELETE 트리거**가 그 노드의 NODE_DOC 를 DELETED. 삭제 함수들을 재정의하지 않는다 → 이후 다른 마이그레이션이 삭제 함수를 바꿔도 새는 곳이 없다 |
| 방 보관 | 파일 그대로(멤버 읽기 전용, 편집 불가 — 기존 규칙) |
| 안전망 | `job_cleanup` 이 `node_id is null` 인 READY NODE_DOC 도 DELETED |
| Storage 정리 | DELETED + 유예 1h(`file_purge_grace`) 지나면 기존 `cleanup-files` 가 remove() 후 행 삭제. 변경 없음 |

## 7. 제한

| 항목 | 값 | 근거 |
|---|---|---|
| 항목당 개수 | **5** (`node_file_limit()` 한 곳) | 제출과 같음(`SUB_LIMITS.files`, 0007·0022) — §11 D1 |
| 파일당 크기 | 10MB | 버킷 `file_size_limit`(0003) · 제출과 같음 |
| 형식 | `allowed_mime_types()` 9종 | 버킷 화이트리스트와 같아야 한다(다르면 Storage 가 먼저 거절) |
| 이름 | 1~255자, 키에 넣지 않음 | 0007 와 같음 |

## 8. 알림

없음. 근거: 설명 글 수정도 알림이 없다(0028 `node_update` 는 일정 변경만 알림). 파일만 따로 알리면 규칙이 어긋나고 편집자 일괄 정리 때 소음이 크다. 필요하면 후속으로 "항목 내용 변경" 알림을 설명·첨부 함께 설계(§11 D4).

## 9. AI 연동(MCP) 영향

- `2026-10-19-ai-integration` 플랜(0031–0033, 이 기능 뒤)은 파일을 다루지 않는다. 충돌 지점 없음: 이 기능은 `node_update`·`curriculum_json`·`node_delete` 를 **재정의하지 않는다**(별도 RPC + 트리거).
- AI 의 `curriculum_plan` 이 노드를 지우면 트리거가 첨부를 정리한다(추가 작업 없음).
- MCP 도구가 노드 상세를 돌려줄 때 첨부는 빠진다 — 후속으로 `node_files` 를 읽기 도구에 노출(이름·크기만, URL 없음)할 수 있다. v1 범위 아님.
- 순서 의존: AI 의 0031 이 `current_user_id()` 를 재정의(보조 신원)해도 이 기능의 헬퍼는 `current_user_id()` 를 부르기만 하므로 무관. 0030(이 기능)이 먼저 배포되므로 AI 플랜 Task 0 은 0030 이 바꾼 `files`·정책·`job_cleanup`·트리거를 확인한 뒤 재정의한다.

## 10. 마이그레이션 번호

- 마지막 = `0029_mine_scope_includes_led.sql`. D7(2026-10-19 확정): **이 기능을 먼저 배포 → `0030_node_attachments.sql`**. AI 연동 플랜·스펙·리포트는 0031–0033 으로 함께 고쳤다.
- 0030 은 배포 후 수정 금지. 기존 마이그레이션(0001~0029) 수정 금지.

## 11. 결정 (2026-10-19 확정 — 추천 기본값 그대로, D7 만 대안 채택)

| # | 질문 | 확정 | 대안 · 비용 |
|---|---|---|---|
| D1 | 항목당 개수 | **5개**(제출과 같음) | 10개 — `node_file_limit()` 와 `NODE_FILE_LIMITS.files` 두 곳만 바꾸면 됨 |
| D2 | 마크다운 설명 안 인라인 이미지 | **v1 제외** — 이미지는 첨부 목록으로 | 넣으려면: 편집기 붙여넣기/드롭 → 업로드 → `![](sgtudy-file:{id})` 삽입, `MarkdownView` 가 id → 서명 URL(300초 만료 → 재서명) 해석, 본문에서 지운 이미지의 정리 규칙, `room-view` 공개 페이지 처리까지 필요. 별도 스펙 권장 |
| D3 | 공개 방 외부인이 첨부를 볼 수 있나 | **아니오**(멤버 전용) | 예 — `node_doc_readable` 에 `can_read_room` 갈래 추가 + 공개 페이지 UI. 강의 자료 무단 배포 위험 |
| D4 | 첨부 변경 알림 | **없음** | 담당자에게 "과제 자료가 추가됐어요" — 설명 변경 알림과 같이 설계해야 일관 |
| D5 | 개인 목표 그룹장 권한 | **빼기만**(추가 불가) | 없음(보관·삭제로만 대응) — 그러면 `node_doc_target` 의 remove-only 갈래 삭제 |
| D6 | 보관된 팀 항목 첨부를 일반 멤버가 보나 | **아니오**(편집자만) | 예 — 보관 항목은 멤버 화면에 원래 안 나오므로 실익 작음 |
| D7 | 마이그레이션 번호 | **0030 — 이 기능 먼저 배포**(확정) | 0033(AI 먼저) — 채택 안 함. AI 플랜은 0031–0033 으로 수정됨 |

## 12. 완료 기준

1. 그룹장·위임 편집자가 회차·묶음·공통·지정 과제 편집에서 파일을 올리고 [저장]하면 보기 상세에 목록이 보이고 멤버가 받을 수 있다.
2. 개인 목표 소유자가 같은 일을 할 수 있고, 그룹장은 남의 개인 목표 첨부를 뺄 수만 있다. 위임 편집자·다른 멤버는 붙이지도 빼지도 못한다.
3. 저장하지 않고 떠난 업로드는 항목에 붙지 않고 24h 뒤 정리 대상이 된다.
4. 항목(서브트리)·개인 목표를 지우면 그 첨부가 DELETED 가 되고 cleanup-files 가 Storage 에서 지운다.
5. 외부인·비로그인은 `files` 행도, 서명 URL 도 얻지 못한다. 미저장 객체는 누구도 서명할 수 없다.
6. 제출 첨부의 기존 동작(한도·정리·열람)은 그대로다(기존 SQL 테스트 전부 통과).
7. 390 에서 가로 스크롤 없음, 버튼 44px.
