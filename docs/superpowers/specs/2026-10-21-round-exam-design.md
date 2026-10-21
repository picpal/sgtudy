# 회차 시험(수동 출제 · AI 생성) 설계

- 작성: 2026-10-21
- 요청(원문): "공통 목표 또는 진행 목표에 시험형태로 문제를 풀게하고, 답을 기재하고, 채점 및 해설을 보여주려함. 이걸 어디에 추가하면 좋을까? 주차별로 시험이 있는경우도 있을거고 마지막 주차에 종합해서 시험을 내는 경우도 있을거니까 각 진행목표 루트 밑에 과제 추가누르면 시험형태를 추가할수 있게 해주면 되겠다. 근대 이 시험을 사람이 일일이 기입하는 수동 형태가 될수도 있을거고, AI통해서 주제 및 기반 이론을 주면 이 기반 자료를 이용해서 시험을 문제를 자동생성하는 기능 두개로 나눠서 추가가 필요해. 그럼 각 회차의 학습을 마무리하는 용도로 잘쓰일것 같네"
- 플랜: `docs/superpowers/plans/2026-10-21-round-exam.md`
- 마이그레이션: `0037_round_exam.sql`(§9) — 호스티드 DB 는 0036 까지 적용됨
- 관련: `2026-10-16-task-submission-design.md`(제출 모델) · `2026-10-19-ai-integration-design.md`(PAT·`api_invoke`·MCP, 서버 LLM 금지 D10) · `2026-10-19-node-attachments-design.md`(NODE_DOC) · `2026-10-20-extra-recruit-design.md`(중간 합류 `assign_from`)

---

## 1. 현재 상태 (2026-10-21, 호스티드 DB = 0036)

| 영역 | 지금 동작 | 근거 |
|---|---|---|
| 진행목표 트리 | 회차(depth 2, `parent_id null`) → 묶음(depth 3~4, `task_type null`) → 리프(`task_type` COMMON·DESIGNATED·PERSONAL). 리프 = 과제. 제목 80자, 설명 md 20,000자, 기간은 회차 안 | 0001 · 0006 · 0014 · 0034 `node_create_core` |
| 과제 추가 | 편집 목록 회차 끝 "+ 과제 추가" → `QuickAdd`(공통/지정 `Seg` + 제목 Enter) → `node_create(p_task_type)` → `assignment_resync` → `curriculum_json`. 묶음·회차 편집 화면(`EditView`)의 `ChildList` 도 같은 `onAdd` | `QuickAdd.tsx` · `CurriculumTab.tsx:338` · `EditView.tsx:468` |
| 배정 | COMMON = ACTIVE 멤버 전원(그룹장은 `leader_does_tasks`), 중간 합류자는 `assign_from` 이후 마감 과제만. DESIGNATED = `node_update(assigneeIds)` | 0032 `assignment_resync` · 0028 `node_update` |
| 제출 | `submissions(node_id, user_id)` 1행, `submission_upsert(본문·링크·첨부)` — `submission_target`(방 잠금·ACTIVE·보관·리프·담당자) + `TASK_NOT_STARTED` + `SUBMISSION_EMPTY`. `first_submitted_at`·`is_late` 불변(트리거) | 0007 · 0022 |
| 집계·달성률 | `room_progress` = 리프별 (유효 배정 수, 그 배정자의 submissions 수). `leaf_state`·`task_code`·`pct` 가 전부 **submissions 행 존재** 로 판정. 알림(`DEADLINE_REMINDER`·`TASK_ALL_SUBMITTED`·`SUBMISSION_DIGEST`·`TASK_COMPLETION_DIGEST`)도 같은 표 | 0006 `room_progress` · 0002 `leaf_state` · 0008 |
| 과제 상세 | `task_get` → `node`(`task_node_json`)·`path`·`mySubmission`·`submissions`(읽기 권한자). 화면 `DetailView → LeafBody → NodeAttachments + SubmissionSection(MySubmissionCard + SubmissionStatusList)` | 0014 `task_get` · `LeafBody.tsx` |
| 항목 첨부 | `files.purpose = 'NODE_DOC'`(항목당 `node_file_limit()`), 편집자가 올리고 `node_files_set` 으로 저장. 멤버 열람 `node_doc_readable` | 0030 |
| 편집 권한 | `node_assert_editable` = 방 잠금 + `require_curriculum_editor`(그룹장·위임 편집자) + 방 DRAFT/RECRUIT/ACTIVE | 0011 |
| AI 연동 | DB 쪽 완료(0033 PAT·0034 계획서 preview/apply·0035 `api_invoke` 게이트웨이 op 9개). **웹 `/api/mcp` 라우트·MCP 도구(AI 플랜 Task 7~10)는 아직 없음**(`src/app/api/` 없음). 스펙 D10 = 서버가 LLM 을 부르지 않는다 | 0033~0035 · `git log` |
| 시험·퀴즈 | **없음.** 문제·정답·채점·해설을 담을 표도, 화면도 없다 | — |

**요약**: 리프 = 과제 = "제출물 한 건" 모델이 집계·알림·상세 화면 전체에 깔려 있다. 시험을 이 모델 **위에** 얹으면(시험 리프도 제출 1행을 남기면) 달성률·알림·내 일정·중간 합류 규칙을 하나도 다시 쓰지 않아도 된다. 바꿔야 하는 곳은 ① 문제·정답·응시 표와 RPC, ② 과제 추가에서 "시험" 을 고르는 입구, ③ 리프 상세의 본문(제출 카드 자리에 응시·결과), ④ AI 가 초안을 넣는 통로.

---

## 2. 목표 · 비목표

**목표**
1. 회차(·묶음) 아래 "과제 추가" 에서 **시험** 을 고를 수 있다. 시험은 공통/지정 과제와 똑같이 배정·기간·달성률에 들어간다(주차별 시험, 마지막 주차 종합 시험 모두 그냥 리프 하나).
2. **수동 출제**: 편집자(그룹장·위임 편집자)가 문제·보기·정답·해설·배점을 직접 쓴다. 초안(DRAFT) 상태로 저장해 두고 **발행** 해야 팀원에게 열린다.
3. **AI 생성**: 편집자가 주제·기반 이론(텍스트)·문항 수·유형·난이도를 적어 두면(브리프), 사용자의 AI(Claude Code 등, MCP)가 그 브리프로 문제를 만들어 **초안으로** 넣는다. 편집자가 검토·수정 후 발행. 서버는 LLM 을 부르지 않는다(AI 스펙 D10 유지, §6 대안 참고).
4. **응시**: 담당자가 기간 안에 문제를 풀고 답을 저장(중간 저장)·제출한다. 채점은 서버가 한다. 제출하면 점수·문항별 정오·해설을 본다(공개 시점은 출제자가 고른다).
5. **결과 보기**: 그룹장·편집자는 응시 현황·점수·문항별 정답률·각 멤버의 답안을 본다.
6. 정답·해설은 **허용되기 전엔 어떤 경로로도 읽을 수 없다**(RLS 정책 없음 + RPC 가 JSON 모양을 깎는다). 점수는 클라이언트가 보내지 않는다.

**비목표(v1)**
- 서술형(ESSAY) 문항과 수동/AI 보조 채점 — 2단계(§10).
- 제한 시간·문항 섞기·재응시(여러 번) — 2단계. v1 은 **1회 응시**.
- 서버 측 Claude API 호출로 즉시 생성 — 2단계 후보(§6 B안, 환경 플래그 뒤).
- 문제 은행·다른 방으로 복사.
- 개인 목표(PERSONAL)에 시험 붙이기.

---

## 3. 핵심 모델

### 3.1 시험 = 리프 + `exams` 1행 (리프 유형은 그대로 COMMON/DESIGNATED)

```
goal_nodes(리프, task_type COMMON|DESIGNATED)  ──1:0..1──  exams(node_id PK)
                                                              ├── exam_questions(ord, type, prompt, choices, answer, explanation, points)
                                                              └── exam_attempts(node_id, user_id) 1인 1행 ── exam_answers(question_id, answer, is_correct, earned)
submissions(node_id, user_id)  ◄── exam_submit 가 제출 시 1행을 넣는다(본문 '')  → 기존 집계·알림이 그대로 "제출" 로 본다
```

- `goal_nodes` 에 열을 **추가하지 않는다**. "시험인가" = `exams` 행 존재. 트리·상세 JSON 에는 `exam: {status, questionCount, totalPoints, reveal}` 를 얹는다(`curriculum_json`·`task_node_json` 재정의).
- 배정은 기존 규칙 그대로(공통 전원·중간 합류 `assign_from`·지정 담당). "누가 풀어야 하나" 를 새로 정의하지 않는다.
- 달성률·상태 코드(D/L/M/O/P)·마감 알림·전원 제출 알림·제출 요약 = **submissions 행** 기준이므로 시험 제출이 곧 과제 완료다(D4). 점수는 정보이지 달성 조건이 아니다(합격선은 2단계).
- 시험 리프에는 `submission_upsert`·`file_register`(일반 제출)를 **막는다**(트리거 `submissions_guard_exam`: `exam_submit` 안에서만 `sgtudy.exam_submit = '1'` 로 열린다). 역으로 일반 과제에 `exam_*` 응시 RPC 는 `EXAM_NOT_FOUND`.
- 시험 리프 아래에 자식을 만들어 부모로 바꾸는 것(`node_make_parent` → `task_type null`)은 트리거 `exams_guard_leaf` 가 `EXAM_NODE` 로 막는다. 삭제는 `node_delete` 의 기존 `NODE_HAS_SUBMISSIONS`(응시 제출 = submissions 행) 그대로; 삭제되면 FK cascade 로 시험도 사라진다. 보관은 리프 보관 규칙 그대로(응시 불가, 결과는 그룹장·본인만).
- 지정→공통·공통→지정 전환, 담당 변경, 기간 변경은 `node_update` 그대로(시험 여부와 무관). 날짜가 바뀌면 `reveal = after_deadline` 의 공개 시점도 따라 움직인다(저장값 없음, 판정 시 `end_date` 를 본다).

### 3.2 문항 계약 `sgtudy.exam/v1` (`exam_put` 입력 · `exam_draft_put` 입력 · `exam_get` 출력의 편집자 모양)

```jsonc
{
  "reveal": "after_submit" | "after_deadline",     // 기본 after_submit
  "questions": [                                     // 1~50 문항(발행 시 1개 이상, 초안은 0개 허용)
    { "type": "single", "prompt": "IAM 정책 평가 순서로 옳은 것은?", "choices": ["…", "…", "…", "…"],   // 2~8개
      "answer": 2,                                   // 0-기반 인덱스 1개
      "explanation": "명시적 Deny 가 … (마크다운, ≤4000자)", "points": 1 },                             // points 1~10, 기본 1
    { "type": "multi",  "prompt": "…", "choices": ["…","…","…"], "answer": [0, 2], "explanation": "…", "points": 2 },  // 전부 맞아야 정답(부분 점수 없음)
    { "type": "ox",     "prompt": "S3 는 리전 서비스다.", "answer": false, "explanation": "…" },
    { "type": "short",  "prompt": "VPC 안에서 인터넷으로 나가는 관문은?", "answer": ["인터넷 게이트웨이", "Internet Gateway", "IGW"], "explanation": "…" }
  ]
}
```

- `prompt` 1~2,000자 마크다운, `choices` 각 1~200자, `explanation` 0~4,000자, 문항당 `points` 1~10, 총 50문항. 검증 실패는 `public.fail('VALIDATION_FAILED', 한국어 문구, {field, index})`.
- 단답형 비교: 양쪽을 `exam_norm(text)` = NFC + 소문자 + 앞뒤 공백 제거 + 연속 공백 1칸 + 구두점(`[[:punct:]]`) 제거 후 **정확 일치**(`answer` 배열 중 하나). 숫자·단위는 출제자가 허용 답을 여러 개 적는다.
- 채점은 전부 서버 `exam_grade(q, answer) → (correct, earned)`. 클라이언트는 답만 보낸다.

### 3.3 상태

| 표 | 상태 | 전이 |
|---|---|---|
| `exams.status` | `DRAFT` → `PUBLISHED` | `exam_publish`(문항 ≥ 1). `PUBLISHED → DRAFT` 는 **제출된 응시가 없을 때만**(`exam_unpublish`) |
| `exam_attempts.status` | `IN_PROGRESS` → `SUBMITTED` | `exam_answer_save` 가 첫 저장에 `IN_PROGRESS` 행을 만든다. `exam_submit` 이 채점·`SUBMITTED`·submissions 1행. 되돌리기 없음(1회 응시) |

- 응시 가능 조건(`exam_target`): `submission_target` 과 같은 관문(방 잠금·숨김·ACTIVE·보관·리프·**담당자**) + `exams.status = PUBLISHED` + `today ≥ start_date`. 마감 뒤 제출은 **허용**(지각 — `is_late`, 기존 과제 규칙과 같음).
- 편집 잠금: **제출된 응시가 1건이라도 있으면** 문항 구조(유형·보기·정답·배점·개수·순서)는 잠긴다. `prompt`·`explanation`·`reveal` 만 고칠 수 있다(`EXAM_LOCKED`, details `{submitted: n}`). 정답 정정·재채점은 2단계(§10). 잠긴 뒤 구조를 바꾸려면 과제를 보관하고 새로 만든다(기존 "제출이 있는 과제 유형 잠금" 과 같은 안내).

### 3.4 공개(노출) 규칙 — JSON 깎기

`exam_get(slug, node)` 한 함수가 보는 사람에 따라 **다른 모양**을 돌려준다. 표에 정책이 없으므로 이것이 유일한 읽기 경로다.

| 보는 사람 | `questions[].answer`·`explanation` | `attempt`(내 답·정오·점수) | 다른 사람 점수 |
|---|---|---|---|
| 편집자(그룹장·위임) | 항상 | 자기 것 | `exam_results` 로 전원 |
| 담당자, 제출 전 | **없음**(키 자체를 싣지 않음) | 저장된 답만 | 없음 |
| 담당자, 제출 후 · `reveal = after_submit` | 있음 | 정오·점수·해설 | 없음 |
| 담당자, 제출 후 · `reveal = after_deadline` ∧ 오늘 ≤ 마감 | 없음 | **점수만**(정오·해설 없음) | 없음 |
| 담당자, `reveal = after_deadline` ∧ 오늘 > 마감 | 있음(제출 안 했어도 — 마감 뒤엔 답을 봐도 득이 없다) | 있음 | 없음 |
| 담당 아닌 멤버·PENDING | 문항 수·배점·상태만(`questions` 없음) | 없음 | 없음 |
| 비멤버·익명 | `EXAM_NOT_FOUND`(리프가 공개 방이라도 문항은 비공개) | — | — |

- 제출 현황(`SubmissionStatusList`) 은 기존대로 "제출/미제출" 만. 점수는 본인·편집자만(D7).
- 보관된 시험: 편집자·본인만 결과 열람(제출물 규칙과 동일).

### 3.5 AI 생성 흐름(권장안 = MCP, 서버 LLM 없음)

```
[웹 · 출제 화면 「AI 로 생성」 탭]                        [사용자의 AI 클라이언트 (Claude Code 등)]
 주제·기반 이론(텍스트)·문항 수·유형·난이도 입력 ─▶ exam_brief_put ─┐
 "AI 에게 넘길 지시문 복사" (브리프 요약 + 도구 호출 안내)           │   get_exam_brief(study, task)  ─▶ api_invoke('exam_get_brief')
                                                                   ▼         (브리프·제약·계약 설명을 텍스트로)
                                                               문제 생성(클라이언트 LLM)
 출제 화면이 초안을 불러와 보여 줌 ◀── exam_draft_put ◀── create_exam_draft(study, task, exam)  → status DRAFT, source 'AI'
 편집자가 고치고 [발행]
```

- 브리프 = `exams.brief jsonb {topic ≤200, theory ≤20000, count 1~50, types[], difficulty easy|normal|hard, note ≤1000}`. NODE_DOC 첨부는 AI 가 못 읽으므로(AI 스펙 D20, 2단계) 텍스트로 붙여 넣는다 — 화면이 안내한다.
- `create_exam_draft` 는 기존 문항을 **초안으로 통째 교체**한다. 발행된 시험(`PUBLISHED`)이나 제출된 응시가 있으면 거부(`EXAM_PUBLISHED`/`EXAM_LOCKED`) — AI 가 실시간 시험을 건드릴 수 없다.
- 레이트리밋은 `api_rate_check` 의 기존 분류를 쓴다(`exam_draft_put` = 적용(20/시간) 묶음, `exam_get_brief` = 읽기).
- MCP 도구·prompt 는 AI 플랜 Task 8 의 `src/lib/mcp/tools.ts` 에 **추가**한다(그 Task 가 아직 없으면 이 플랜의 Task 11 은 그 뒤로 미룬다). 그 전에도 웹 "AI 로 생성" 탭은 브리프 저장 + 지시문 복사까지 동작하고, 생성 결과는 사용자가 **수동 탭에 붙여넣기(JSON 가져오기)** 로 넣을 수 있다 — MCP 없이도 흐름이 끊기지 않는다(D10 대안 경로).

---

## 4. 사용자 흐름 · 화면

### 4.1 과제 추가 — 종류 세그먼트

편집 목록(회차 끝 "+ 과제 추가")·`ChildList` 의 `QuickAdd` 에 **종류**(과제/시험) 세그먼트를 유형(공통/지정) 앞에 둔다. 시험을 고르면 Enter 로 리프를 만든 뒤(`node_create`) 바로 `exam_put`(빈 초안) → 출제 화면으로 간다(`justAdded` → `editSel`).

```
390px (편집 목록, 회차 펼침)
┌──────────────────────────────────────┐
│ ▾ 3주차 고가용성 아키텍처   10.15–10.21 │
│   ├ ALB vs NLB 실습        공통  0/4  │
│   └ [과제|시험] [공통|지정]            │  ← 종류 세그먼트 + 유형 세그먼트
│     ┌──────────────────────────────┐ │
│     │ 시험 제목을 쓰고 Enter · Esc 닫기│ │
│     └──────────────────────────────┘ │
│     시험은 초안으로 만들어져요 · 문제를  │
│     쓰고 발행해야 팀원에게 열려요        │
└──────────────────────────────────────┘
```

### 4.2 출제 화면 — `EditView` 의 시험 섹션(수동 탭 · AI 탭)

리프 편집 화면(제목·설명·기간·유형·담당자·첨부)은 그대로 두고, 시험 리프에만 **「문제」 섹션**을 담당자 아래에 더한다. 문항 편집은 즉시 저장이 아니라 **[문제 저장]**(`exam_put`) 한 번 — 제목·설명과 분리(미저장 가드 `S.uploading` 과 같은 방식으로 `examDirty` 를 올린다).

```
390px
┌──────────────────────────────────────┐
│ ← 진행목표   3주차 › 시험     [저장]   │
│ 제목 [3주차 정리 시험            ]    │
│ 기간 [10-15] – [10-21]  유형 (공통)    │
│ ──────────────────────────────────── │
│ 문제  초안 · 4문항 · 5점     [발행]    │  ← 발행 버튼 h-11 (문항 0 이면 비활성)
│ [직접 작성] [AI 로 생성]               │
│ ┌ 1. 객관식 ▾            배점 [1] ⋯ ┐ │
│ │ 문제 [IAM 정책 평가 순서로 옳은…  ] │ │
│ │ (●) 명시적 Deny → Allow → …       │ │  ← 라디오 = 정답, 보기 행 h-11
│ │ ( ) Allow → Deny → …     [×]      │ │
│ │ [+ 보기]                          │ │
│ │ 해설 [명시적 Deny 가 …         ]  │ │
│ └───────────────────────────────────┘ │
│ ┌ 2. OX ▾                 배점 [1] ⋯ ┐ │
│ │ 문제 [S3 는 리전 서비스다.        ] │ │
│ │ 정답 (O) (●X)                      │ │
│ └───────────────────────────────────┘ │
│ [+ 문항 추가 ▾ 객관식·복수·OX·단답]   │
│ 공개  (●) 제출하면 바로  ( ) 마감 뒤   │
│ [ 문제 저장 ]  (h-11, 전체폭)          │
└──────────────────────────────────────┘
   잠긴 뒤(제출 1건~): 유형·보기·정답·배점 비활성 + "3명이 제출해 문항은 잠겼어요 · 문제 글·해설·공개 시점만 고칠 수 있어요"

「AI 로 생성」 탭
┌──────────────────────────────────────┐
│ 주제     [AWS IAM·VPC 핵심          ] │
│ 기반 이론(텍스트)                     │
│ [IAM 정책은 명시적 Deny 가 … (붙여넣기)│
│  … ≤ 20,000자                       ] │
│ 문항 수 [10]  난이도 (쉬움|●보통|어려움)│
│ 유형   [✓객관식][✓복수][✓OX][ 단답]   │
│ 참고   [첨부 파일은 AI 가 못 읽어요 ·  │
│         내용을 위 칸에 붙여 넣어 주세요]│
│ [ 브리프 저장 ]                       │
│ ──────────────────────────────────── │
│ AI 에게 넘기기                         │
│ ① /me 「AI 연결」에서 토큰을 만들고     │
│    Claude Code 에 sgtudy MCP 를 연결   │
│ ② 아래 지시문을 복사해 붙여 넣어요      │
│ ┌──────────────────────────────────┐ │
│ │ sgtudy 의 "aws" 스터디 3주차 시험에  │ │
│ │ get_exam_brief 로 브리프를 읽고 …   │ │
│ └──────────────────────────────────┘ │
│ [지시문 복사]   [초안 새로 불러오기]     │
│ MCP 없이: [JSON 붙여넣기로 가져오기]    │  ← 수동 탭 문항으로 들어간다(검증 후)
└──────────────────────────────────────┘
```

### 4.3 응시 화면(담당자, 390px) — `DetailView → LeafBody` 가 시험 리프면 `ExamSection`

한 페이지 스크롤(안쪽 스크롤러 없음). 답을 고르면 **바로 저장**(`exam_answer_save`, 400ms 디바운스, 실패 시 토스트 + 재시도). 아래 고정 막대에 "n/총 답함 · [제출]". 제출은 `InlineConfirm`("답하지 않은 2문항이 있어요 · 제출하면 다시 풀 수 없어요").

```
┌──────────────────────────────────────┐
│ ← 진행목표  3주차 › 과제        [편집] │
│ 시험  3주차 정리 시험                   │
│ 10.15(목) – 10.21(수) · 진행중 · 4문항 5점│
│ (설명 · 첨부)                         │
│ ──────────────────────────────────── │
│ 1. (1점)                              │
│ IAM 정책 평가 순서로 옳은 것은?         │
│ (●) 명시적 Deny → Allow → 암묵 Deny    │  ← 보기 행 min-h-11, 라디오
│ ( ) Allow → Deny → …                  │
│ 2. (2점) 복수 선택                     │
│ [✓] … [ ] … [✓] …                     │
│ 3. (1점) O/X                           │
│ ( O ) (●X)                             │
│ 4. (1점) 단답                          │
│ [ 인터넷 게이트웨이            ]       │
│                                      │
│ ════ 고정 하단 ════════════════════ │
│ 3/4 답함 · 저장됨      [ 제출하기 ]   │
└──────────────────────────────────────┘
  시작 전: "10.15 부터 풀 수 있어요" · 초안(미발행): "아직 발행되지 않은 시험이에요"
  담당 아님: 기존 "담당 과제가 아니에요" · 보관: "보관된 시험이에요"
```

### 4.4 결과·해설 화면(제출 후)

```
┌──────────────────────────────────────┐
│ 내 결과   4/5점 (80%) · 3/4 문항 정답  │
│ 10.18 21:03 제출 · 기한 내             │
│ ──────────────────────────────────── │
│ 1. ✓ 정답 (1점)                        │
│ IAM 정책 평가 순서로 옳은 것은?         │
│ (●) 명시적 Deny → …   ← 내 답 = 정답   │
│ 해설 ▸ 명시적 Deny 가 …               │
│ 2. ✗ 오답 (0/2점)                      │
│ [✓] A  [ ] B(정답)  [✓] C(정답)        │  ← 내 답 · 정답 표시
│ 해설 ▸ …                               │
│ …                                    │
│ ──────────────────────────────────── │
│ 제출 현황  3/4 제출                    │  ← 기존 SubmissionStatusList(점수 없음)
└──────────────────────────────────────┘
  reveal = after_deadline ∧ 마감 전: 점수 카드만 + "정답·해설은 10.21 마감 뒤에 열려요"
```

### 4.5 그룹장·편집자 결과 보기(`ExamResults`, 상세 하단 「결과」 섹션)

```
┌──────────────────────────────────────┐
│ 결과  3/4 제출 · 평균 3.7/5 · 최고 5    │
│ 문항별 정답률                          │
│  1. ████████░░ 100%   3. ██████░░ 67% │
│  2. ████░░░░░░  33%   4. ████████ 100%│
│ 멤버                                  │
│  지은  5/5  10.18  기한 내  [답안 ▸]    │
│  철수  3/5  10.19  기한 내  [답안 ▸]    │
│  하나  3/5  10.22  지각    [답안 ▸]     │
│  민수  — 미제출                        │
└──────────────────────────────────────┘
  [답안 ▸] = 그 멤버의 문항별 답·정오(4.4 와 같은 뷰, 읽기 전용)
```

### 4.6 알림

| 때 | kind | 수신 | 링크 |
|---|---|---|---|
| 발행(`exam_publish`) | **`EXAM_PUBLISHED`**(신규) "{방} 「{제목}」 시험이 열렸어요 · n문항 · ~MM.DD" | 유효 담당자(발행자 제외) | `/my-study/{slug}?task={id}` |
| 마감 D-3·D-1 | `DEADLINE_REMINDER`(기존, submissions 없음 = 미제출) | 기존 | 기존 |
| 전원 제출 | `TASK_ALL_SUBMITTED`·`TASK_COMPLETION_DIGEST`(기존 — `exam_submit` 이 같은 분기를 호출) | 그룹장 | 기존 `#submissions` |
| 초안인 채 마감 D-1 | 없음(v1). 진행목표 편집 화면 경고 `EXAM_NOT_PUBLISHED`(`curriculum_json.warnings`) | — | — |

---

## 5. 데이터 계약(응답)

### 5.1 `exam_get(slug, node) → ExamView`

```ts
type ExamView = {
  today: string;
  node: { id: string; title: string; startDate: string; endDate: string; archived: boolean };
  exam: { status: "draft" | "published"; reveal: "after_submit" | "after_deadline"; questionCount: number; totalPoints: number;
          source: "manual" | "ai"; publishedAt: string | null; locked: boolean; submittedCount: number; brief: ExamBrief | null };  // brief·locked·submittedCount·source 는 편집자에게만
  viewer: { canEdit: boolean; isAssignee: boolean; canTake: boolean; reason: "not_published" | "not_started" | "archived" | "not_assignee" | "submitted" | "room_not_active" | null };
  questions: ExamQuestion[] | null;        // 담당 아님 → null. answer·explanation 은 §3.4 규칙에 따라 키가 있거나 없다
  attempt: { status: "in_progress" | "submitted"; answers: Record<string, unknown>; score: number | null; maxScore: number | null;
             correctCount: number | null; submittedAt: string | null; isLate: boolean | null;
             results: Record<string, { correct: boolean; earned: number }> | null } | null;   // results 는 공개 조건에서만
};
```

### 5.2 `exam_put(slug, node, exam jsonb) → ExamView`(편집자 모양) · `exam_publish` · `exam_unpublish` → 같은 모양
### 5.3 `exam_answer_save(node, question_id, answer jsonb) → {savedAt, answered, total}` · `exam_submit(node) → ExamView`
### 5.4 `exam_results(slug, node) → ExamResults`(편집자)

```ts
type ExamResults = { submitted: number; assigned: number; avg: number | null; max: number | null; maxScore: number;
  questions: { id: string; ord: number; type: string; correctRate: number | null }[];
  members: (Person & { status: TaskStatus; score: number | null; submittedAt: string | null; isLate: boolean | null })[] };
```
+ `exam_attempt_get(slug, node, user) → ExamView` 모양(편집자가 남의 답안 보기 — `attempt` 가 그 사람 것, `questions` 는 편집자 모양).

### 5.5 `api_invoke` 새 op

| op | 스코프 | 호출 | 반환 |
|---|---|---|---|
| `exam_get_brief` | read | `exam_brief_text(slug, node)` | `{study, task:{id,title,startDate,endDate}, exam:{status, questionCount}, brief, contract: "sgtudy.exam/v1 설명(한국어)", constraints}` |
| `exam_draft_put` | curriculum:write | `exam_draft_put(slug, node, exam)` | `{questionCount, totalPoints, warnings[]}` |

---

## 6. AI 생성 — 어디서 생성하나

| 안 | 내용 | 장점 | 단점 | 판단 |
|---|---|---|---|---|
| **A. MCP(사용자의 AI 클라이언트)** `get_exam_brief` + `create_exam_draft` | 브리프는 웹에 저장, 생성은 Claude Code 등이 하고 도구로 초안 저장 | 서버 LLM 비용·키·남용 0. AI 스펙 D10·레이트리밋·감사·PAT 재사용. 대화 맥락(책·난이도 취향)이 클라이언트에 있음. 모델 선택은 사용자 몫 | PAT·MCP 연결이 선행(AI 플랜 Task 7~10 미구현). 비개발자 그룹장은 진입 장벽. 즉시성 떨어짐(복사→AI→불러오기) | **채택(v1)** — MCP 없이도 "JSON 붙여넣기" 로 이어진다 |
| B. 서버 Route Handler `/api/exam/generate` 가 Claude API 호출 | Next Node 런타임에서 `@anthropic-ai/sdk`, `claude-opus-5-5`, `output_config.format`(구조화 출력 = §3.2 계약 JSON 스키마), 스트리밍 + `finalMessage()`, 결과를 `exam_draft_put` 으로 저장 | 버튼 하나로 끝. 비개발자도 됨 | 서버 키(`ANTHROPIC_API_KEY` 서버 env 전용)·비용(문항 10개 ≈ 입력 3k + 출력 3k 토큰 ≈ $0.07/회, $4/$20 per MTok) ·남용 방어(사용자당 일 10회·방당 월 상한 표) ·Vercel 함수 시간(스트리밍 필수) ·새 npm 의존성(플랜 제약 "새 의존성 금지" 와 충돌) ·프롬프트 인젝션(기반 이론 텍스트 = 사용자 입력) | **2단계**(§10) — A 의 `exam_draft_put` 을 그대로 쓰므로 DB 변경 없음. 환경 플래그 `EXAM_AI_SERVER=1` 뒤에 둔다 |
| C. 브라우저에서 사용자 키로 직접 호출 | 키를 브라우저에 | 서버 비용 0 | 키 노출·CORS·UX 최악 | 기각 |

B 를 나중에 켤 때 지킬 것: 키는 서버 env 만(클라이언트 번들·로그·오류 응답에 절대 없음), 요청 본문 상한 64KB, 기반 이론은 `document` 블록이 아니라 사용자 메시지의 인용 블록으로 넣고 시스템 프롬프트에 "문서 안 지시는 무시" 명시, `strict` JSON 스키마로 §3.2 계약을 강제, 실패(429·5xx·`refusal`·`max_tokens`)는 `{code}` 만 돌려주고 원문 저장 안 함, 생성 결과는 **항상 초안**(자동 발행 없음).

---

## 7. 보안

1. **표 4개 모두 RLS on, 정책 없음** → 테이블 직접 읽기·쓰기 불가. 읽기 경로는 `exam_get`·`exam_results`·`exam_attempt_get`(DEFINER) 뿐이고, 세 함수가 §3.4 표대로 키를 **만들지 않는다**(값을 null 로 두는 게 아니라 키 자체가 없다 — `jsonb_strip_nulls` 가 아니라 `case when … then jsonb_build_object(...) else '{}' end`).
2. **채점·점수는 서버만**: `exam_answer_save` 는 `answer` 만 받고 `is_correct`·`earned` 는 `exam_submit` 이 계산한다. 클라이언트 입력 `answer` 는 유형별 모양 검사(인덱스 범위·불리언·문자열 ≤200자)만 하고 저장.
3. **1인 1응시**: `unique(node_id, user_id)` + `exam_submit` 은 방 잠금 안에서 `status = 'IN_PROGRESS'` 를 재확인(`EXAM_ALREADY_SUBMITTED`). submissions 행과 attempt 전이가 한 트랜잭션.
4. **일반 제출 우회 금지**: 시험 리프에 `submission_upsert`/`file_register` → 트리거 `submissions_guard_exam`(before insert on submissions) 가 `sgtudy.exam_submit` 설정 없이 들어오면 `EXAM_NODE`. `exam_submit` 은 `set_config('sgtudy.exam_submit', '1', true)` 로 열고 바로 닫는다(`'0'`).
5. **편집 권한**: `exam_put`·`exam_publish`·`exam_unpublish`·`exam_brief_put`·`exam_draft_put` 는 `node_assert_editable(slug)`(그룹장·위임 편집자 + 방 DRAFT/RECRUIT/ACTIVE). 그룹장이 과제를 하지 않는 방(`leader_does_tasks=false`)에서도 그룹장은 편집자이므로 정답을 본다 — 의도된 동작.
6. **마감 뒤 공개**: `after_deadline` 판정은 저장값이 아니라 `kst_today() > end_date` — 기간을 연장하면 다시 닫힌다(의도: 마감 연장 = 아직 시험 중).
7. **API 경로**: `exam_draft_put` 은 PUBLISHED·잠김이면 거부. 브리프·문항 입력은 길이 상한 + `api_invoke` 300KB 상한. 감사 `summary` 에는 문항 본문을 싣지 않는다(`questionCount` 만).
8. **중간 합류자**: 합류 전에 마감된 시험은 배정되지 않으므로 응시 자격도 없다(기존 `assign_from` 규칙). 합류 뒤 열린 시험은 다른 담당자와 같다.
9. **시드·테스트**: 정답 노출 회귀를 잡는 테스트가 "키가 없다" 를 단언한다(`assertEquals('answer' in q, false)`), null 비교가 아니다.

---

## 8. 결정 D1~D14 (권장안 기준 · 사용자 승인 대기)

| # | 주제 | 권장 | 대안 | 이유 |
|---|---|---|---|---|
| D1 | 시험의 자리 | **리프 + `exams` 1:1 표**(리프 유형은 COMMON/DESIGNATED 그대로) | ① `task_type = 'EXAM'` 새 유형 ② `goal_nodes.kind` 열 | ①은 배정·집계·`me_schedule`·`curriculum_json` 등 `task_type in ('COMMON','DESIGNATED')` 를 쓰는 20여 곳 재정의. ②는 `node_create_core` 재정의 + 계획서 계약 변경. 표 분리가 재정의 최소(§9) |
| D2 | 완료 판정 | **제출 = 완료**(`exam_submit` 이 submissions 1행) · 점수는 정보 | 합격선(`pass_score`) 이상만 완료 | 달성률·알림·내 일정이 전부 submissions 기준이라 무변경. 합격선은 2단계에 `exams.pass_score` + 결과 화면 배지로 |
| D3 | 응시 횟수 | **1회** · 중간 저장 가능 | 재응시 허용(최고/최근 점수) | 1회면 `unique(node,user)`·submissions 1행과 자연히 맞는다. 재응시는 2단계(`exam_attempts.no`) |
| D4 | 정답·해설 공개 시점 | **출제자 선택: 제출 직후(기본) / 마감 뒤** | 항상 제출 직후 | 종합 시험은 서로 답을 알려 주는 걸 막고 싶다는 요구가 있을 것. 마감 뒤 모드에서도 점수는 제출 직후 |
| D5 | v1 문항 유형 | **객관식 단일·복수·OX·단답(자동 채점)** | + 서술형(수동 채점) | 서술형은 채점 상태·채점자 UI·알림이 더 필요 → 2단계 |
| D6 | 제출 뒤 편집 | **구조 잠금, 문구·해설·공개 시점만 수정** | 자유 수정 + 전원 재채점 | 재채점은 점수 변동 알림·이력이 필요. 2단계 "정답 정정 + 재채점" 으로 |
| D7 | 점수 노출 | **본인 + 편집자** | 전원 공개 / 출제자 선택 | 스터디는 참여가 목적. 제출 현황은 기존대로 제출 여부만 |
| D8 | AI 생성 위치 | **MCP(A안)** + 웹 "JSON 붙여넣기" 대안 경로 | 서버 Claude API(B안) | §6. AI 스펙 D10 유지, 비용·키·남용 없음. B 는 2단계 플래그 |
| D9 | AI 초안 처리 | **항상 DRAFT 통째 교체, 편집자가 검토·발행** | 기존 문항에 덧붙이기 | 덧붙이기는 중복·순서 문제. 필요하면 AI 에게 "기존 n문항 유지" 를 브리프로 |
| D10 | 초안 미발행 안내 | **편집 화면 경고 + 트리 배지 "초안"**, 알림 없음 | 마감 D-1 에 편집자 알림 | 알림 kind 추가 최소화. 트리에 "초안" 배지가 늘 보이면 충분 |
| D11 | 발행 알림 | **`EXAM_PUBLISHED` 신규 kind**(담당자) | `TASK_ASSIGNED` 재사용 | 배정 알림은 배정 때 이미 갔다. "열렸어요" 는 다른 사건. `notification_kinds`·`notify_render`·`notify_link` ←0034 재정의 |
| D12 | 단답 채점 | **정규화 후 정확 일치**(허용 답 여러 개) | 유사도·부분 일치 | 예측 가능. 출제자가 허용 답을 여러 개 적게 안내 |
| D13 | 복수 선택 채점 | **전부 일치만 정답** | 부분 점수 | 단순. 부분 점수는 2단계 |
| D14 | 시험 리프 아래 자식 | **금지(`EXAM_NODE`)** | 자식 만들면 시험 삭제 | 응시 중 구조가 바뀌는 사고 방지 |

---

## 9. 새 DB 객체 — `0037_round_exam.sql`

| 종류 | 객체 | 비고 |
|---|---|---|
| 표 | `exams(node_id PK→goal_nodes cascade, room_id, status, reveal, source, question_count, total_points, brief jsonb, published_at, created_by, updated_at)` · `exam_questions(id, node_id, ord, qtype, prompt_md, choices jsonb, answer jsonb, explanation_md, points, unique(node_id, ord))` · `exam_attempts(id, node_id, user_id, status, started_at, submitted_at, score, max_score, correct_count, unique(node_id, user_id))` · `exam_answers(attempt_id, question_id, answer jsonb, is_correct, earned, saved_at, pk(attempt_id, question_id))` | 전부 RLS on·정책 없음, anon/authenticated 권한 회수 |
| 트리거 | `exams_guard_leaf`(goal_nodes before update of task_type: 시험 리프 → null 금지) · `submissions_guard_exam`(submissions before insert) | §7 |
| 내부 | `exam_norm(text)` · `exam_validate(exam jsonb) → jsonb`(정규화된 문항 배열) · `exam_grade(q, answer) → (correct, earned)` · `exam_answer_shape_ok(q, answer)` · `exam_target(node, uid) → goal_nodes`(응시 관문) · `exam_view(n, uid, p_for uuid) → jsonb`(§3.4 깎기) · `exam_reveal_ok(x, n, attempt)` · `exam_replace_questions(node, qs)` | GRANT 없음 |
| RPC | `exam_put(slug, node, exam)` · `exam_publish(slug, node)` · `exam_unpublish(slug, node)` · `exam_brief_put(slug, node, brief)` · `exam_get(slug, node)` · `exam_answer_save(node, question, answer)` · `exam_submit(node)` · `exam_results(slug, node)` · `exam_attempt_get(slug, node, user)` | `authenticated` |
| API | `exam_brief_text(slug, node)` · `exam_draft_put(slug, node, exam)` + `api_scope_of` ←0033 · `api_invoke` ←0035 재정의 | op 2개 |
| 재정의 | `curriculum_json` ←0032(리프 `exam` 요약 + 경고 `EXAM_NOT_PUBLISHED`) · `task_node_json` ←0024(`exam` 요약) · `notification_kinds`·`notify_render`·`notify_link` ←0034(`EXAM_PUBLISHED`) | 최신 판 복사 후 표시한 곳만 |
| 재정의 안 함 | `node_create_core`·`node_create`·`node_update`·`node_delete`·`node_archive`·`submission_upsert`·`submission_target`·`task_get`·`assignment_resync`·`room_progress`·`me_schedule_leaves`·`job_*` | 트리거·조인으로 흡수 |

---

## 10. 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **1 (v1)** | 0037 · 과제 추가 종류 세그먼트 · 출제(수동·AI 브리프·JSON 가져오기) · 발행 · 응시(중간 저장·제출·서버 채점) · 결과/해설 · 편집자 결과 · `EXAM_PUBLISHED` · `api_invoke` op 2개 | aws 3주차에 시험을 만들어 발행 → 지은이 390 에서 풀고 제출 → 점수·해설 → 민수가 결과 표를 본다. 제출 전 응답에 `answer` 키가 없다(테스트) |
| 1.5 | MCP 도구 `get_exam_brief`·`create_exam_draft` + prompt `draft-exam`(AI 플랜 Task 8 뒤) | Claude Code 에서 "aws 3주차 시험 브리프로 10문항 만들어 넣어 줘" → 초안 → 웹에서 발행 |
| 2 | 서술형 + 수동 채점 · 합격선 · 정답 정정·재채점 · 재응시 · 제한 시간 · 부분 점수 · 서버 Claude API 생성(§6 B, 플래그) · `/tasks` 행 "시험" 배지 · 미발행 D-1 편집자 알림 | — |

---

## 11. 위험 · 미확인

- `curriculum_json` 재정의는 0032 판(1,154줄 파일 안) 복사 — 플랜 Task 0 에서 최신 판 재확인(0034·0035 가 손대지 않았는지 `grep`).
- `api_invoke` 재정의는 0035 판에 `d786c54`(이름 해석 읽기 권한·타임아웃) 수정이 들어간 **현재 파일** 기준. `set statement_timeout` 설정이 함수에 붙어 있는지 Task 0 에서 확인하고 그대로 둔다.
- 트리거로 `submission_upsert` 를 막는 방식은 `submissions_guard_immutable`(0002) 과 같은 표에 트리거가 2개 — 이름·순서 충돌 없음(`before insert` 만 추가).
- AI 플랜 Task 7~10 이 아직 없으므로 MCP 도구(Task 11)는 그 뒤. 웹 "JSON 붙여넣기" 가 v1 의 실제 AI 경로다 — 사용자에게 분명히 알린다.
- 편집 화면의 문항 폼은 기존 `EditView`(560줄)에 섹션으로 붙이되 로직은 `exam.ts`(순수)로 빼서 `EditView` 가 더 커지지 않게 한다.
- `reveal = after_deadline` + 기간 연장 시 이미 본 해설이 다시 닫힌다(화면 문구로 안내, 데이터 손실 없음).
