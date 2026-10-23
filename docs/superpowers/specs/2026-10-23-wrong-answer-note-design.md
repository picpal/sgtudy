# 오답노트(내 스터디 탭) — 설계

2026-10-23 · 마이그레이션 **0046**(0045 는 md-images 가 쓴다) · 요청(원문): "추가 기능 : 오답노트 내스터디에 탭하나 추가해서 오답노트를 하나 만들어주고, 오답노트는 각주차에서 진행된 시험에서 오답들을 모아놓고, 다시 풀기 할수있도록 하며 / 각 문제 해설 보기 기능도 있으면 좋겠어"

- 플랜: `docs/superpowers/plans/2026-10-23-wrong-answer-note.md`
- 관련: `2026-10-21-round-exam-design.md`(시험 모델 · §3.4 공개 규칙 · D4 공개 시점 · D7 점수는 본인·편집자만) · `0037_round_exam.sql`(`exam_view`·`exam_reveal_ok`·`exam_closed`·`exam_grade`·`exam_answer_shape_ok`)
- 형식 참고: `2026-10-22-feedback-design.md`

---

## 1. 현재 상태 (2026-10-23, 마이그레이션 0044 까지)

| 영역 | 지금 동작 | 근거 |
|---|---|---|
| 내 스터디 탭 | `routes.MY_STUDY_TABS = [overview, notice, curriculum, board, calendar, gantt]` 가 유일한 탭 키 목록. `StudyHeaderInfo.TABS`(라벨)·`leaveGuard.screenKeyOf`(?tab= 정규화)·`settingsBackOf`(from 화이트리스트)·`MyStudyScreen.dom.test`("TABS 순서 = MY_STUDY_TABS")가 전부 이 목록을 본다. 탭 막대는 `overflow-x-auto`(좁으면 가로 스크롤), 공지 탭만 안 읽음 점 | `src/lib/routes.ts:54` · `StudyHeaderInfo.tsx:16` · `MyStudyScreen.tsx:498~503`(탭별 분기) |
| 탭 안 데이터 | 공지 탭처럼 탭 컴포넌트가 마운트될 때 자기 RPC 를 부른다(`fetchNotices`). 미저장 가드는 `blocksLeave` 가 탭별 플래그(`noticeUnsaved` 등)로 판정 | `NoticeTab.tsx` · `state.ts:147` |
| 시험 정오 | `exam_submit` 만 `exam_answers.is_correct·earned` 를 채운다(미답 문항도 `answer='null'`·오답 행을 남긴다). 1인 1응시(`unique(node_id,user_id)`) | `0037:668~678` |
| 정답·해설 공개 | `exam_reveal_ok(x, n, a)` = `after_submit` 이면 제출 뒤, `after_deadline` 이면 `kst_today() > end_date`(저장값 아님 — 기간 연장 = 다시 닫힘). `exam_view` 는 공개 전엔 `answer`·`explanation`·`results` **키를 만들지 않는다**. 공개 뒤 결과 화면(`ExamSection` result 모드)에는 정답·해설이 이미 보인다 | `0037:500~506 · 562~583` · `ExamQuestionView.tsx:126~165` |
| 공개 전 점수 | `after_deadline` 마감 전이라도 `attempt.score·maxScore·correctCount` 는 제출 직후 보인다(문항별 정오는 없음) | `0037:573~582` · 스펙 D4 |
| 문항 화면 | `ExamQuestionView`(`<li>`) 가 `take`(라디오·체크·O/X·단답 칸)와 `result`(내 답·정답 표시·정오·`<details>` 해설) 두 모드를 가진다. 서버가 보낸 키만 그린다(`"answer" in q`) | `ExamQuestionView.tsx` |
| 회차 | 루트 노드(`parent_id is null`, `sort_order`)가 회차. 리프의 회차는 `parent_id` 를 거슬러 올라가 찾는다(`task_get` 의 `with recursive up`) | `0014:519` · `0037:823` |
| 다시 풀기 | **없음.** 응시는 1회(D3)이고 연습 모드·연습 기록 표가 없다 | — |
| 내 과제 `/tasks` | 서버 `page.tsx` 가 `me_tasks` 한 번 → `TasksScreen(initial)`. 필터는 전부 URL 쿼리(`scope·group·type·done·study`), `parseFilter`/`filterQuery`/`normalizeFilter`(모르는 study 는 "all" 로 정리) → `history.replaceState`(RSC 왕복 없음). 툴바 = 기간 Seg · 묶기 Seg(390 은 select) · 유형 칩 · 완료 숨기기 · **스터디 칩 줄**(2개 이상일 때, ≤640 가로 스크롤). 본문 = 스터디별 `h2`(점 + 제목 + 「진행목표 ›」) → `RoundGroupCard`. 빈 상태 `TasksEmpty(noStudy·noTasks·filtered)` | `src/app/tasks/page.tsx` · `components/tasks/TasksScreen.tsx:41~` · `TasksToolbar.tsx` · `calc.ts:7~47` |

**요약**: 오답은 이미 `exam_answers(is_correct=false)` 에 있고, 공개 판정도 `exam_reveal_ok` 한 곳에 있다. 새로 필요한 것은 ① 내 오답을 회차별로 모아 주는 읽기 RPC(공개 규칙 재사용), ② 공식 점수를 건드리지 않는 연습 채점·기록 RPC + 표 1개, ③ 탭 하나. 시험 표·`exam_*` 함수는 재정의하지 않는다.

---

## 2. 목표 · 비목표

**목표**
1. 내 스터디에 「오답노트」 탭. 이 방에서 **내가 제출한** 시험의 오답(미답 포함)을 **회차별**로 모아 보여 준다.
1-b. 「내 과제」(`/tasks`)에서도 과제 목록과 나란히 **모든 스터디의 오답**을 스터디별 → 회차별로 보고, 스터디 필터(`?study=`)와 연동한다. 다시 풀기·해설 보기는 방 탭과 똑같이 동작한다(같은 컴포넌트).
2. 문항마다 **정답·해설 보기**(접었다 펼침)와 **다시 풀기**(연습 채점). 시험 단위 묶음 다시 풀기도 된다.
3. 연습은 공식 점수·응시·제출·달성률·알림을 **전혀 바꾸지 않는다**.
4. 정답·해설이 아직 공개되지 않은 시험(`after_deadline` 마감 전)은 **잠금**으로만 보이고, 서버가 문항·정답·해설을 싣지 않는다.

**비목표(v1)**
- 다른 사람의 오답(그룹장이 팀원 오답 보기) — 편집자 결과 화면(`ExamResults`)이 이미 멤버별 답안을 보여 준다.
- `/tasks` 에서 과제와 오답을 한 목록에 섞어 정렬(마감일 묶기 안에 오답 행) — 오답은 마감이 없다. v1 은 보기 전환(D17).
- 오답 문항을 모아 새 시험으로 출제 · 간격 반복(SRS) 스케줄 — 2단계.
- 탭 배지(오답 수 점) — §8 D12.

---

## 3. 결정 (권장안 = 구현안)

| # | 주제 | 선택지 | 권장(구현) · 이유 |
|---|---|---|---|
| D1 | 오답의 정의 | (a) `is_correct=false` 행 (b) 점수 < 배점 | **(a)** — `exam_submit` 이 채점한 `exam_answers.is_correct=false` 행(미답 문항 포함 — `answer='null'`). 복수 선택 부분 정답도 오답(D13 전부 일치 규칙과 같다). 노트 **소속은 저장하지 않고 조인으로 유도**한다 — 재채점(2단계)이 생겨도 표가 어긋나지 않는다 |
| D2 | 범위 | 본인 / 편집자는 전원 | **본인 attempt 만**(`exam_attempts.user_id = auth.uid()`). 편집자도 자기 오답만 본다. 남의 답안은 `ExamResults`→`exam_attempt_get` 이 이미 담당(D7) |
| D3 | 공개 전 시험 | (a) 숨김 (b) 잠금 표시(개수만) (c) 문항은 보이되 정답만 숨김 | **(b)** — `exam_reveal_ok(x, n, a)` 가 거짓이면 그 시험은 `locked: true` + `lockedCount`(= `max(총 문항 - correct_count, 0)`) + `unlockDate`(= `end_date`) 만. 문항·내 답·정답·해설은 **키 자체를 싣지 않는다**. 근거: `after_deadline` 마감 전에도 `correctCount` 는 이미 보이므로(0037 `exam_view`) "오답 n문항" 개수는 새 정보가 아니다. 반면 **어느 문항이** 틀렸는지는 공개 전 비밀(문항별 `results` 가 없다)이라 (c) 는 D4 를 깬다. 기간 연장으로 다시 닫히면 자동으로 다시 잠긴다(저장값 없음) |
| D4 | 공개 강제 위치 | 서버 / 클라이언트 | **서버 RPC 가 강제**. 읽기 `wrong_note_list` 와 연습 `wrong_note_practice` 둘 다 `public.exam_reveal_ok` 를 **그대로 호출**한다(복사하지 않는다). 클라이언트는 `locked` 플래그로 문구만 바꾼다 |
| D5 | 정답 키를 클라이언트에 미리 보내나 | 보냄 / 연습 뒤에만 | **공개된 시험은 목록에 `answer`·`explanation` 을 싣는다.** 근거: 공개 뒤엔 결과 화면(`ExamSection` result 모드 → `ExamQuestionView` 가 정답 행에 「정답」 태그·해설 `<details>`)에서 **이미 그 사용자에게 보이는 값**이라 새 노출이 아니다. 「해설 보기」 토글은 호출 없이 즉시 열려야 하고(문항당 RPC 는 과하다), 연습 화면에서 정답을 가리는 것은 **UX 문제이지 보안이 아니다**. 공개 전 시험은 D3 대로 키 없음 |
| D6 | 연습 채점 위치·저장 | (a) 클라이언트 채점·저장 없음 (b) 서버 채점·저장 | **(b)** — `wrong_note_practice` 가 `exam_answer_shape_ok` → `exam_grade` 로 채점하고 `exam_practice` 표에 기록한다. 근거: ① 채점 규칙(단답 `exam_norm` 정확 일치·복수 전부 일치)을 두 번 구현하지 않는다(`exam.ts` 의 `examNorm` 은 "근사"라고 적혀 있다) ② 필터 「다시 풀어 맞힘」·「외움」 이 기기와 세션을 넘어 남는다 ③ 호출 비용은 `exam_answer_save` 와 같은 급. 클라이언트는 정오를 **계산하지 않고** 서버 응답만 그린다 |
| D7 | 다시 풀기 단위 | 문항 / 시험 / 회차 / 전체 | **문항 + 시험 묶음** 둘 다. RPC 는 하나(`wrong_note_practice(p_slug, p_answers jsonb)`, 배열 1~50) — 문항 하나는 길이 1 배열. 회차·전체 묶음은 v1 에 없다(시험 카드마다 [이 시험 다시 풀기] 로 충분) |
| D8 | 노트에서 빠지는 조건 | (a) 연습에서 맞히면 자동 제거 (b) 표시만 (c) 사용자가 「다 외웠어요」 | **(b)+(c)** — 연습 정오는 **표시·필터**로만(「다시 풀어 맞힘」 배지). 제거는 사용자가 문항의 [외웠어요] 를 눌렀을 때만(`mastered_at`), 기본 목록에서 숨기고 「외운 문제 n개 보기」 토글로 되돌릴 수 있다(되돌리기 = [다시 노트에]). 근거: O/X·객관식은 찍어서 맞을 수 있고, 외웠는지는 본인만 안다. 자동 제거는 되돌릴 수 없는 사용자 경험 |
| D9 | 연습 기록 모양 | 시도 로그 전부 / 문항당 1행 | **문항당 1행**(`exam_practice(user_id, question_id)` PK): `last_correct`·`correct_count`·`wrong_count`·`last_answer`·`last_practiced_at`·`mastered_at`. 시도 이력은 필요 없다(2단계 SRS 가 필요로 하면 그때 로그 표) |
| D10 | 회차 묶음 기준 | 루트 노드 / 날짜 | **루트 노드**(`parent_id is null` 까지 거슬러 올라감, `task_get` 의 `with recursive up` 과 같은 식). 순서 = 루트 `sort_order` → 리프 `sort_order` → 문항 `ord`. 묶음(depth 3~4)은 표시하지 않는다(시험 카드 제목이면 충분). 보관된 리프(`archived_at is not null`)는 뺀다(진행목표 기본 목록과 같다) |
| D11 | 필터 | 없음 / 3개 | **칩 3개: 전체 · 아직 못 맞힘 · 다시 풀어 맞힘** + 「외운 문제 n개 보기」 토글. 「아직 못 맞힘」 = 연습 행 없음 또는 `last_correct=false`. 필터는 클라이언트(응답 한 번에 전부 온다, 상한 50문항 × 시험 수) |
| D12 | 탭 이름·위치·배지 | — | 키 `wrong`, 라벨 **「오답노트」**, `MY_STUDY_TABS` **맨 끝**(간트 뒤). 근거: 기존 탭 순서·테스트(`routes.test` "slice(0,2)=[overview, notice]")를 건드리지 않고, 복습은 진행 중 흐름보다 뒤에 오는 활동. **탭 배지 없음** — 공지의 안 읽음 점은 화면 진입마다 `notice_inbox` 를 부르는 비용을 이미 내고 있고, 오답 수는 "안 읽음" 같은 신호가 아니다. 개수는 탭 안 머리줄에 |
| D13 | 해설 없는 문항 | 토글 숨김 / 안내 | **「해설이 없는 문항이에요」** 를 토글 자리에 회색 한 줄로. 근거: 토글이 안 보이면 "안 불러와진 건가" 로 오해한다. 정답 표시는 해설 유무와 무관하게 「정답·해설 ▸」 안에서 |
| D14 | 연습 응답의 범위 | 정답 포함 / 정오만 | **정오 + 갱신된 연습 행만**(`{questionId, correct, practice}`, 합계 없음 — D21). 정답·해설은 목록에 이미 있다(D5). 연습 뒤 화면은 `ExamQuestionView` result 모드(내 답·정답·정오) + 해설 **자동 펼침** |
| D15 | 미저장 가드 | 탭 이탈 시 묻기 / 안 묻기 | **안 묻는다.** 연습 중 고른 답은 [채점] 전까지 메모리에만 있고 잃어도 되는 값이다(공식 답이 아니다). `blocksLeave` 에 플래그를 더하지 않는다 |
| D16 | 종료·보관된 방 | 숨김 / 읽기 | **읽기·연습 모두 허용**(`room_readable` + 멤버 자격만). 종료된 방에서 복습하는 것이 오답노트의 본래 쓰임. 승인 대기(PENDING)는 공지와 같이 「참가가 승인되면 볼 수 있어요」 |
| D17 | `/tasks` 화면 형태 | (a) 「과제 / 오답노트」 보기 전환 (b) 같은 화면 아래 섹션 (c) 별도 `/notes` 화면 | **(a)** — 툴바 맨 앞에 Seg 「과제 · 오답노트」, URL `?view=notes`(기본 `tasks`, `filterQuery` 가 기본값을 뺀다). 근거: 과제 목록은 이미 스터디 × 회차 카드로 길어 (b) 는 오답이 화면 두 번째 스크롤 아래로 밀린다. (c) 는 사용자가 "내 과제 페이지에서" 라고 했고 스터디 칩 필터를 다시 만들어야 한다. (a) 는 **스터디 칩 줄을 그대로 공유**하고 기간·묶기·유형·완료 숨기기(오답에 뜻이 없는 필터)는 오답노트 보기에서 숨긴다 |
| D18 | 방 가로지르기 RPC | (a) `wrong_note_list(p_slug nullable)` (b) 별도 `wrong_note_mine()` | **(b)** — `wrong_note_mine() → {today, studies: [{slug, title, tone, status, hasExam, totals, rounds}]}`. 내부를 `wrong_note_rounds(p_room, p_uid) → jsonb`·`wrong_note_totals` 로 빼서 두 RPC 가 같은 함수를 부른다(노출 규칙은 여전히 한 곳). 근거: 방 응답의 `viewer: pending` 분기·`ROOM_NOT_FOUND` 관문은 방 단위 의미라 nullable 로 합치면 분기가 두 겹이 된다. 대상 방 = `me_studies(false)` 와 같은 자격(그룹장·ACTIVE·INACTIVE, **보관 제외**, PENDING 제외). 응답에 시험이 하나도 없는 방도 `hasExam:false` 로 싣는다(빈 상태 문구 분기) — 스터디 칩 목록은 `me_tasks.studies` 를 그대로 쓰므로 응답의 `studies` 는 칩이 아니라 본문용 |
| D19 | `/tasks` 데이터 로드 | 서버 동시 로드 / 클라이언트 지연 | **클라이언트 지연** — `view=notes` 가 된 렌더(전환 또는 새로고침 진입)에서 `fetchWrongNoteMine()`. 근거: `/tasks` 는 과제가 기본 보기이고 `page.tsx` 의 서버 병렬 로드(`me_tasks`)를 늦추지 않는다. 한 번 받으면 세션 안에서 유지, 「과제」 로 돌아갔다 와도 재요청 없음(연습·외움 응답으로 갱신). `progressChangedSince` 재조회 때 함께 다시 받는다(제출 뒤 돌아온 경우 새 오답이 보이도록) |
| D20 | `/tasks` 필터 연동 | — | `?study=slug` 면 그 스터디 섹션만(클라이언트 필터 — 응답은 전체 한 번). 오답 필터 칩(전체·아직 못 맞힘·다시 풀어 맞힘)·외운 문제 토글은 **URL 에 싣지 않는다**(방 탭과 같이 컴포넌트 상태). 연습·외움 RPC 는 `p_slug` 그대로 — 각 시험 카드가 자기 스터디 slug 를 안다 |
| D21 | 머리줄 합계 | 서버 totals / 클라이언트 합산 | **클라이언트 `totalsOf(rounds)`** 가 정본 — 필터·스터디 선택·연습 뒤 즉시 갱신, 방 하나든 여럿이든 같은 함수. 서버 `totals` 는 목록 응답에만(테스트·초기값), **연습·외움 응답은 `totals` 를 돌려주지 않는다**(D14 수정) |
| D22 | 목록 모양 (2026-10-23 개편) | 회차 h3 + 문항 펼침 / 회차 카드 | **회차 카드 그리드**(≤ 1열 at 390) — 회차명·기간·시험 수·오답/미답/다시 풀어 맞힘/외움/잠김. 문항은 상세에서만. 기간은 응답에 없어 화면이 넘긴다(방 탭 = 커리큘럼 루트 노드, `/tasks` = me_tasks rounds, 이탈 방은 기간 줄 생략) — **DB 변경 없음** |
| D23 | 상세 주소 | 상태 / URL | **`?round=<id>`** (방 탭 `?tab=wrong&round=`, `/tasks` `?view=notes&…&round=`) — 카드 = push, [회차 목록] = 이 화면이 쌓은 기록이면 back·딥링크면 replace(커리큘럼 상세 origin 복귀와 같은 규칙). 다른 탭·과제 보기로 가면 `round` 를 지운다. 회차를 옮기면 다시 풀기 입력은 버린다(D15) |
| D24 | 필터 위치 | 목록 / 상세 / 둘 다 | **둘 다, 같은 상태** — 목록에선 그 조건에 맞는 문항이 없는 카드를 숨기고 「조건에 맞는 n문항」 표시(카드 숫자는 필터 전 기준), 상세에선 문항을 거른다. 전부 잠긴 회차 카드는 누를 수 없고(자물쇠 + 「…마감 뒤에 열려요」), 주소로 열면 잠금 안내 + 잠금 시험 카드만(정답 키 없음 그대로) |
| D25 | 상세 문항 이동 | — | 시험 응시 `ExamNav` 를 `QuestionNav` 로 일반화해 재사용 — 본문 폭 ≥ 760 이면 오른쪽 따라오는 칸, 좁으면 하단 막대 [문항 이동] 판. **시험별로 묶고 번호는 시험 안 번호**(문항 머리와 같은 수). 묶음 다시 풀기 중인 시험 칸은 답함/안 답함 + 「n/총 답함」 |
| D26 | 다시 푼 횟수 색 | — | 횟수 = `correctCount + wrongCount`, **4단계**: 0 기본 · 1 `blue-soft` · 2 `blue` · 3번+ `navy`. 마지막 정오는 칸 귀퉁이 ✓(done)·✗(warn). 색만으로 구분하지 않게 aria-label·title 「n번 문항 · 2번 다시 풀었어요 · 마지막에 맞힘」. **각주는 번호 칸 아래**(펼친 칸·판 안). 연습 응답을 목록에 합치므로(mergePractice) 채점 즉시 바뀐다 |

---

## 4. 데이터 · RPC (0046)

### 4.1 표 `public.exam_practice` (D6·D9)

```sql
create table public.exam_practice (
  user_id           uuid   not null references public.profiles(id) on delete cascade,
  question_id       bigint not null references public.exam_questions(id) on delete cascade,
  node_id           bigint not null references public.exams(node_id) on delete cascade,   -- 목록 조인·방별 집계용(질문의 node 와 같음, 트리거 없이 RPC 가 넣는다)
  last_correct      boolean,                  -- 마지막 연습 정오 (외웠어요만 눌렀으면 null)
  correct_count     int    not null default 0,
  wrong_count       int    not null default 0,
  last_answer       jsonb,                    -- 마지막 연습 답(canon) — 「다시 풀어 맞힘」 뒤 화면 복원용
  last_practiced_at timestamptz,
  mastered_at       timestamptz,              -- D8 「외웠어요」
  updated_at        timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index ix_exam_practice_user_node on public.exam_practice (user_id, node_id);
create index ix_exam_attempts_user on public.exam_attempts (user_id);   -- 목록이 user → attempts 로 들어간다(기존 unique 는 node_id 선행)
alter table public.exam_practice enable row level security;
revoke all on public.exam_practice from anon, authenticated;            -- RPC 전용
```

- `exam_attempts`·`exam_answers`·`submissions` 는 **읽기만**. 연습은 어떤 경우에도 이 세 표를 갱신하지 않는다(테스트가 단언).
- 기존 0037 함수는 재정의하지 않는다. 쓰는 것: `exam_reveal_ok`·`exam_closed`·`exam_grade`·`exam_answer_shape_ok`·`exam_answer_canon`·`exam_is_answered`·`exam_viewer_member`·`room_readable`·`require_user`·`iso`·`fail`.

### 4.2 `wrong_note_list(p_slug text) → jsonb` (authenticated)

관문: `require_user` → 방 `slug` + `room_readable` 아니면 `ROOM_NOT_FOUND` → `exam_viewer_member(r, uid)`(그룹장·ACTIVE·INACTIVE·PENDING) 아니면 `ROOM_NOT_FOUND`. PENDING 은 `viewer: "pending"` 으로 빈 응답(공지 D10 과 같이 내용 없음).

```ts
type WrongNote = {
  today: string;                                   // YYYY-MM-DD (kst_today)
  viewer: "member" | "pending";
  hasExam: boolean;                                // 이 방에 발행된 시험(보관 제외)이 하나라도 있나 — 빈 상태 분기
  totals: { wrong: number; retriedOk: number; mastered: number; locked: number };   // wrong = 공개된 오답 수(외운 것 포함), locked = 잠긴 시험의 lockedCount 합
  rounds: {
    id: string; title: string;                     // 루트 노드
    exams: {
      nodeId: string; title: string; endDate: string; reveal: ExamReveal;
      score: number | null; maxScore: number | null; correctCount: number | null; questionCount: number;
      locked: boolean;                             // D3 — exam_reveal_ok 거짓
      lockedCount?: number; unlockDate?: string;   // locked 일 때만
      items?: WrongNoteItem[];                     // locked 가 아닐 때만. 길이 ≥ 1 (오답 0 인 시험은 목록에서 뺀다)
    }[];
  }[];
};
type WrongNoteItem = {
  question: ExamQuestion;                          // id·ord·type·prompt·choices·points + answer·explanation (공개된 시험이라 항상 있다, D5)
  no: number;                                      // 시험 안 번호(ord+1) — "3번"
  mine: unknown;                                   // 제출 때 내 답(JSON null = 답하지 않음)
  practice: { lastCorrect: boolean | null; correctCount: number; wrongCount: number; lastAnswer: unknown; lastAt: string | null } | null;
  mastered: boolean;
};
```

- 조인: `exam_attempts a(user_id=uid, status='SUBMITTED')` → `exams x`·`goal_nodes n`(`archived_at is null`) → `exam_answers e(attempt_id=a.id, is_correct=false)` → `exam_questions q` → `exam_practice p(left)`. 회차는 `with recursive up` 으로 루트까지.
- 잠금 판정: `not public.exam_reveal_ok(x, n, a)` → 그 시험은 `locked` 블록만 만든다(`case … then jsonb_build_object(...) else` 로 **키 없음**, 0037 §7-1 과 같은 방식). `lockedCount = greatest(x.question_count - coalesce(a.correct_count, 0), 0)`.
- 오답이 0 개인 시험(만점)은 응답에서 뺀다. 오답이 있는 시험이 없는 회차도 뺀다.
- 편집자 우회 없음: `exam_view` 의 `v_edit` 처럼 편집자에게 항상 정답을 주는 분기를 **두지 않는다**(자기 시험을 자기가 풀고 공개 전인 경우는 없지만, 규칙을 하나로). 편집자가 정답을 보고 싶으면 편집 화면.

### 4.2-b `wrong_note_mine() → jsonb` (authenticated, D18 — `/tasks`)

```ts
type WrongNoteMine = {
  today: string;
  studies: { slug: string; title: string; tone: Tone; status: RoomStatusDto; hasExam: boolean; totals: WrongNote["totals"]; rounds: WrongNote["rounds"] }[];
};
```

- 대상 방: `rooms r` × `room_members m(user_id = uid, status in ('ACTIVE','INACTIVE'))` ∪ `r.leader_id = uid`, `r.archived_at is null`. 정렬 = `me_studies` 와 같은 순서(그 함수의 `order by` 를 확인해 맞춘다). `tone` 은 `me_tasks.studies[].tone` 과 같은 식(`room_tone` 류 헬퍼가 있으면 그것).
- 각 방의 `rounds`·`totals`·`hasExam` 은 **`wrong_note_list` 와 같은 내부 함수**(`wrong_note_rounds(p_room, p_uid)`·`wrong_note_totals`·`wrong_note_has_exam`)로 만든다 — `wrong_note_list` 는 관문 뒤 이 세 함수를 부르는 얇은 껍데기가 된다.
- 멤버 자격 검사는 조인 조건이 대신한다(PENDING 행은 조인에서 빠진다). 비로그인은 `require_user`.
- **의도한 차이**: DRAFT(모집 전) 방의 비그룹장 멤버와 보관된 방은 `wrong_note_list`(방 탭, `room_readable` 관문)로는 보이지만 `wrong_note_mine` 에서는 빠진다 — `/tasks` 는 `me_studies` 와 같은 "지금 다니는 방" 목록이고, 그 방들의 오답은 방 탭에서 본다.

### 4.3 `wrong_note_practice(p_slug text, p_answers jsonb) → jsonb` (authenticated, D6·D7·D14)

입력 `[{questionId: string, answer: jsonb}]`, 길이 1~50(초과 `VALIDATION_FAILED`), 같은 `questionId` 두 번도 `VALIDATION_FAILED`(field `answers`). 각 문항에 대해:

1. `q` ← `exam_questions`, `x`·`n` ← 그 시험(방 slug 와 일치, 아니면 `NODE_NOT_FOUND`).
2. 내 제출 응시 `a`(`SUBMITTED`) 가 없거나 리프가 보관됐으면 **`WRONG_NOTE_NOT_IN`**("오답노트에 없는 문항이에요"). 남의 문항·미제출 시험은 이 코드(존재 숨김).
3. `exam_reveal_ok(x, n, a)` 거짓이면 정오와 무관하게 **`WRONG_NOTE_LOCKED`**("정답이 공개된 뒤에 다시 풀 수 있어요", details `{unlockDate}`). 클라이언트가 잠긴 시험에 연습 UI 를 안 그리지만, 서버가 막는다.
3-b. 마지막으로 `exam_answers(a.id, q.id).is_correct = false` 가 아니면(맞힌 문항) `WRONG_NOTE_NOT_IN`. **순서가 보안 조건**이다 — 공개 판정을 정오보다 뒤에 두면 잠긴 시험에서 맞힌 문항은 NOT_IN, 틀린 문항은 LOCKED 로 갈라져 공개 전 문항별 정오가 샌다(D3). `wrong_note_master` 도 같은 관문.
4. `exam_answer_shape_ok(q, answer)` 거짓이면 `VALIDATION_FAILED`(details `{questionId}`). 답이 비어 있으면(`exam_is_answered` 거짓) 오답으로 채점(공식 채점과 동일).
5. `exam_grade(q, answer)` → `correct`. `exam_practice` upsert: `last_correct`, `correct_count/wrong_count += 1`, `last_answer = exam_answer_canon`, `last_practiced_at = app_now()`. **`mastered_at` 은 건드리지 않는다**(외운 문항을 다시 풀어도 외움 상태 유지 — 사용자가 직접 되돌린다).
6. 한 트랜잭션. 하나라도 실패하면 전부 롤백(묶음 채점이 반쯤 기록되지 않게).

응답: `{ results: { [questionId]: { correct: boolean; practice: WrongNoteItem["practice"] } } }` — 정답·해설·합계는 돌려주지 않는다(목록에 있고, 합계는 클라이언트 `totalsOf`, D21).

### 4.4 `wrong_note_master(p_slug text, p_question bigint, p_on boolean) → jsonb` (authenticated, D8)

2·3 과 같은 관문(노트에 있고 공개된 문항만 — 잠긴 시험은 외울 수도 없다). `mastered_at = case when p_on then app_now() else null end`(행이 없으면 만든다, 카운트 0). 응답 `{ mastered: boolean }`.

### 4.5 오류 코드

| 코드 | 언제 | 화면 |
|---|---|---|
| `ROOM_NOT_FOUND` | 비멤버·없는 방 | 기존 공용 문구 |
| `WRONG_NOTE_NOT_IN` | 노트에 없는 문항(맞힘·남의 것·미제출·문항 교체됨) | 토스트 「오답노트에 없는 문항이에요」 + 목록 다시 받기 |
| `WRONG_NOTE_LOCKED` | 공개 전 | 토스트 「정답이 공개된 뒤에 다시 풀 수 있어요」 + 다시 받기(잠금 카드로 바뀐다) |
| `VALIDATION_FAILED` | 답 모양·배열 길이 | 그 문항에 「답을 확인해 주세요」 |
| `AUTH_REQUIRED` | 비로그인 | 기존 로그인 유도 |

---

## 5. 보안

1. **정답·해설은 `exam_reveal_ok` 가 참일 때만**, 그것도 `wrong_note_list` 한 함수가 싣는다. 잠긴 시험은 `items`·`question` 키 자체가 없다(테스트는 `"items" in exam === false` 를 단언 — null 비교가 아니다). 연습 RPC 도 같은 함수로 재검사한다(클라이언트가 잠긴 문항 id 를 보내도 `WRONG_NOTE_LOCKED`).
2. **본인만**: 모든 RPC 가 `auth.uid()` 의 attempt 만 조인한다. `p_user` 인자가 없다. 남의 문항 id 는 `WRONG_NOTE_NOT_IN`(존재 숨김).
3. **공식 기록 불변**: 연습 RPC 는 `exam_attempts`·`exam_answers`·`submissions`·`exams` 에 쓰지 않는다. `submissions_guard_exam` 등 기존 트리거도 건드리지 않는다. 테스트가 연습 전후 세 표의 행·점수를 비교한다.
4. **정답 키 노출 판단(D5)**: 공개된 시험의 키는 `exam_get` 이 이미 그 사용자에게 돌려주는 값이라 노출 범위가 넓어지지 않는다. 비멤버·PENDING·공개 전 사용자에게는 어떤 경로로도 키가 없다(`exam_get` 과 같은 자격 검사 `exam_viewer_member`).
5. **표 권한**: `exam_practice` RLS on·정책 없음·anon/authenticated 권한 회수. 내부 헬퍼는 GRANT 없음, 공개 RPC 4개(`wrong_note_list`·`wrong_note_mine`·`wrong_note_practice`·`wrong_note_master`)만 `authenticated`.
5-b. **`wrong_note_mine` 도 같은 내부 함수**(`wrong_note_rounds`)를 부르므로 잠금·본인 규칙이 두 경로에서 같다. 방 목록 조인이 PENDING·보관·비멤버를 거르고, 테스트는 두 RPC 의 같은 방 응답(`rounds`)이 **동일**함을 단언한다.
6. **입력 상한**: 배열 ≤ 50, 답 모양은 `exam_answer_shape_ok`(단답 ≤ 200자·복수 ≤ 50개). 레이트리밋은 두지 않는다(`exam_answer_save` 와 같은 급의 쓰기, 사용자 자기 행만).
7. **`api_invoke`/MCP 노출 없음** — 허용 목록 그대로(의견 보내기 D11 과 같은 판단).

---

## 6. 화면

### 6.1 탭 (데스크톱 · 본문 카드 안, `S.tab === "wrong"`)

```
┌────────────────────────────────────────────────────────────┐
│ 개요  공지  진행목표  보드  캘린더  간트  [오답노트]           │
│                                                            │
│ 오답 12문항 · 다시 풀어 맞힘 4 · 외움 2        ← totals      │
│ [전체] [아직 못 맞힘] [다시 풀어 맞힘]   ☐ 외운 문제 2개 보기  │  ← 칩(radiogroup) + 토글
│ ─────────────────────────────────────────────────────────  │
│ 3주차                                            ← h3 회차  │
│ ┌ 3주차 정리 시험  3/5점 · 오답 2문항      [이 시험 다시 풀기] ┐ │
│ │ 2. (2점) 복수 선택               ✗ 미답 · 다시 풀어 맞힘  │ │  ← 배지: 제출 결과 ✗ / 연습 상태
│ │   VPC 구성 요소를 모두 고르세요                          │ │
│ │   [✓] 서브넷  [ ] IGW  [✓] S3     ← 내 답(제출 때)       │ │
│ │   [다시 풀기]  [외웠어요]   정답·해설 ▸                   │ │  ← details 닫힘
│ │ 4. (1점) 단답                     ✗ 오답                 │ │
│ │   …                                                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│ 4주차                                                      │
│ ┌ 종합 시험  4/10점 · 오답 6문항 · 10.28 마감 뒤에 열려요 🔒 ┐ │  ← locked 카드: 개수·날짜만, 문항 없음
│ └─────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

- 문항 기본 상태 = `ExamQuestionView mode="result"` 에 **정답 키를 뺀 사본**(`{...q, answer: undefined, explanation: undefined}` 가 아니라 키를 지운 객체)을 넘겨 내 답만 표시(`hasKey=false` 분기 → 정답 태그 없음). 그 아래 [다시 풀기]·[외웠어요] 버튼과 「정답·해설 ▸」 `<details>`(열면 정답 키가 있는 `ExamQuestionView mode="result"` 로 다시 그린다 + 해설, 없으면 D13 문구).
- **[다시 풀기]**(문항): 그 `<li>` 가 `mode="take"` 로 바뀐다(이전 답 비움). [채점] → `wrong_note_practice([{…}])` → `mode="result"` + 정오 배지(✓ 맞혔어요 / ✗ 또 틀렸어요) + 정답 표시 + 해설 **자동 펼침**(`ExamQuestionView` 에 `explanationOpen` prop 추가). [한 번 더] 로 다시 take.
- **[이 시험 다시 풀기]**(묶음): 그 카드의 모든 문항이 take 로. 카드 하단 막대 「n/m 답함 · [채점] [그만두기]」(`sticky bottom-0`, `ExamSection` 의 하단 막대와 같은 방식·`-mx-7 max-[901px]:-mx-4`). [채점] 한 번 = RPC 한 번(배열). 결과는 문항별로 위와 같이, 막대는 「m문항 중 k 맞힘」 요약 + [닫기].
- **[외웠어요]**: `wrong_note_master(on)` → 목록에서 사라지고 토스트 「외운 문제로 옮겼어요 · 「외운 문제 보기」로 되돌릴 수 있어요」. 외운 문제 보기를 켜면 회색 배지 「외움」 + [다시 노트에].
- 필터 칩은 클라이언트. 필터 결과가 비면 칩 아래 「조건에 맞는 문항이 없어요」.
- 데이터는 탭 마운트에 `fetchWrongNote(slug)` 한 번. 실패 → 「오답노트를 불러오지 못했어요 [다시 시도]」. 연습·외움 응답을 목록에 반영(`mergePractice`·`setMastered`)하고 머리줄은 `totalsOf` 로 다시 계산(목록 재조회 없음).
- **공용 컴포넌트**: 목록·시험 카드·문항·다시 풀기·해설·외움은 `WrongNoteList({ studies, filter, showMastered, onPractice, onMaster, … })` 하나에 있다. `studies` = `[{slug, title?, tone?, rounds}]`. 방 탭은 길이 1·제목 없이(`h3` 회차부터), `/tasks` 는 여러 개·스터디 `h2` 머리 포함(§6.5). 시험 카드는 자기 `slug` 로 연습·외움 RPC 를 부른다.

### 6.2 빈 상태

| 상황 | 문구 |
|---|---|
| `viewer === "pending"` | 「참가가 승인되면 오답노트를 볼 수 있어요」 |
| `hasExam === false` | 「아직 시험이 없는 방이에요 · 시험을 제출하면 틀린 문항이 여기에 모여요」 |
| 시험은 있는데 `rounds` 빈 배열 · `totals.locked === 0` · `mastered === 0` | 「틀린 문항이 없어요 · 제출한 시험을 전부 맞혔거나 아직 제출한 시험이 없어요」 |
| `rounds` 빈 배열 · `mastered > 0` | 「전부 외웠어요 · 외운 문제 n개 보기」(토글 켜기 링크) |
| 잠긴 시험만 있음 | 잠금 카드만(위 문구 없음) |

### 6.3 모바일 (390)

- 한 열. 칩 줄은 `overflow-x-auto`(탭 막대와 같다), 토글은 다음 줄로 내려간다(`flex-wrap`).
- 시험 카드 머리: 제목 한 줄 + 점수·오답 수 줄 + [이 시험 다시 풀기] 는 아래로 떨어진다(`flex-wrap`). 버튼·보기 행 ≥ 44px(기존 `row` 클래스 재사용).
- 묶음 채점 하단 막대는 `sticky bottom-0` — 안쪽 스크롤러 없음(한 페이지 스크롤 원칙).
- 탭 막대 7개는 390 에서 가로 스크롤(이미 `overflow-x-auto`). 「오답노트」 가 맨 끝이라 처음엔 일부 가려질 수 있다 — 허용(공지·간트와 같은 규칙). 확인 폭 390 / 820 / 1440.

### 6.5 내 과제 `/tasks` — 「오답노트」 보기 (D17~D21)

```
┌────────────────────────────────────────────────────────────┐
│ 내 과제                                   [＋ 내 목표 추가]  │
│ ┌ 툴바 ───────────────────────────────────────────────────┐ │
│ │ [과제 · 오답노트]   (기간·묶기·유형·완료 숨기기 = 과제 보기만) │ │  ← Seg 맨 앞, ?view=notes
│ │ 스터디  [모든 스터디] [● aws] [● spring]                  │ │  ← 기존 칩 줄 공유(?study=)
│ └─────────────────────────────────────────────────────────┘ │
│ 오답 12문항 · 다시 풀어 맞힘 4 · 외움 2        ← totalsOf     │
│ [전체] [아직 못 맞힘] [다시 풀어 맞힘]   ☐ 외운 문제 2개 보기  │
│ ● AWS 스터디                                   오답노트 ›   │  ← h2(점·제목, 기존 과제 보기의 h2 와 같은 줄) → routes.myStudyTab(slug,"wrong")
│   3주차                                                    │
│   ┌ 3주차 정리 시험  3/5점 · 오답 2문항  [이 시험 다시 풀기] ┐ │  ← WrongNoteList 그대로
│   └─────────────────────────────────────────────────────┘ │
│ ● Spring 스터디                                 오답노트 ›   │
│   아직 시험이 없는 방이에요                                  │  ← hasExam=false 스터디는 한 줄
└────────────────────────────────────────────────────────────┘
```

- 「＋ 내 목표 추가」·요약 줄(남은 팀 과제 n개…)은 과제 보기의 것 — 오답노트 보기에서는 숨기고 `totalsOf` 머리줄로 바꾼다. `aria-busy`·토스트는 화면 공용.
- `?study=slug` 가 있으면 그 스터디 섹션만, `h2` 는 그대로 둔다(어느 스터디인지 보이게). 모르는 slug 는 기존 `normalizeFilter` 가 "all" 로 정리한다.
- 빈 상태: 스터디 0 → 기존 `TasksEmpty noStudy`. 전 스터디 `hasExam=false` → 「아직 시험이 없어요 · 시험을 제출하면 틀린 문항이 여기에 모여요」. 시험은 있는데 오답 0·잠금 0 → 「틀린 문항이 없어요 · 제출한 시험을 전부 맞혔거나 아직 제출한 시험이 없어요」. 필터로 비면 「조건에 맞는 문항이 없어요」. 스터디 섹션 단위 빈 문구는 위 그림처럼 한 줄.
- 390: Seg 「과제 · 오답노트」 는 기간 Seg 와 같은 크기(h-11)로 첫 줄 맨 앞. 스터디 칩 줄은 기존 가로 스크롤. 본문은 방 탭과 같은 한 열, 묶음 채점 막대 `sticky bottom-0`(`-mx-7` 대신 `/tasks` 본문 패딩에 맞춘 `-mx-4`·`max-sm:-mx-2` — `TasksScreen` 의 본문 컨테이너 패딩을 보고 맞춘다).
- 과제 보기 ↔ 오답노트 보기 전환은 `history.replaceState`(기존 필터와 같다, 기록 안 쌓음). 브라우저 뒤로 가기로 돌아온 `?view=notes` 주소도 그대로 오답노트 보기로 열린다(D19).

### 6.4 문항 유형별

| 유형 | 기본(내 답) | 다시 풀기 입력 | 결과 |
|---|---|---|---|
| single | 보기 목록, 내 선택 ● + 「내 답」 태그, 정답 태그 없음 | 라디오 | 정답 행 초록 + 「정답」, 내 답 행 |
| multi | 체크 표시 | 체크박스 | 같음(전부 일치만 정답) |
| ox | `dl` 내 답 O/X | O/X 두 버튼 | `dl` 내 답·정답 |
| short | `dl` 내 답 글자(미답 「답하지 않았어요」) | 글 칸(≤200) | `dl` 내 답·정답(허용 답 `/` 로 나열 — 기존 `ResultBody`) |

전부 `ExamQuestionView` 재사용 — 새 입력 컴포넌트 없음. 미답 문항(`mine = null`)은 배지 「미답」.

---

## 7. 다른 작업과의 경계

| 진행 중 | 겹치는 파일 | 이 기능의 처리 |
|---|---|---|
| exam-results-card(`ExamSection.tsx`·`ExamResults.tsx`·`SubmitPanel.tsx`·`MyStudyScreen.tsx` 2줄) | `MyStudyScreen.tsx` 탭 분기 1줄 추가 | `ExamSection`·`ExamResults`·`SubmitPanel` 은 **건드리지 않는다**. `MyStudyScreen` 은 `S.tab === "gantt"` 줄 아래 한 줄만 추가 — 그 작업이 커밋된 뒤 rebase |
| md-images(`markdown.ts`·`MarkdownView`·0045) | `MarkdownView` 를 소비만 | 렌더러 변경과 무관. 마이그레이션은 **0046** 고정(Task 0 에서 0045 존재 여부와 무관하게 0046 사용, 0046 이 이미 있으면 멈춤) |
| `ExamQuestionView.tsx` | 두 작업 모두 안 건드림(diff stat 확인) | `explanationOpen?: boolean` prop 하나만 **추가**(기본 false, 기존 동작 불변) |

---

## 8. 테스트 계획

**SQL(`supabase/tests/wrong-note-sql.test.ts`, deno+PGlite, `round-exam-sql.test.ts` 의 `newExamLeaf`·`Q4` 헬퍼 재사용)**
1. `exam_practice` anon/authenticated 권한 전부 거짓, RLS on.
2. 지은이 4문항 중 2문항 틀리고 1문항 미답 → `wrong_note_list('aws')` 에 3항목, `ord` 순, `question.answer`·`explanation` 있음, `mine` 이 제출 답, 미답은 `mine = null`. 맞힌 문항 없음. 만점 시험은 응답에 없음. 회차 제목 = 루트 제목.
3. `after_deadline` 시험, 마감 전: 그 시험 `locked=true`, `lockedCount=3`, `unlockDate`, **`"items" in exam === false`**, `totals.locked=3`. `set_today` 마감 다음 날 → 열림. 다시 기간 연장 → 다시 잠김.
4. `wrong_note_practice`: 단답 「 igw! 」 → correct(`exam_norm`), 복수 부분 선택 → 오답, OX, 빈 답 → 오답. `correct_count/wrong_count` 증가, `last_correct`, `last_answer` canon. 배열 2개 한 번에. 51개 → `VALIDATION_FAILED`.
5. 연습 전후 `exam_attempts.score·correct_count`, `exam_answers.is_correct`, `submissions` 행 **동일**(스냅샷 비교).
6. 맞힌 문항 id → `WRONG_NOTE_NOT_IN`. 남(철수)의 오답 id → `WRONG_NOTE_NOT_IN`. 미제출 시험 → `WRONG_NOTE_NOT_IN`. 잠긴 시험 → `WRONG_NOTE_LOCKED`. 다른 방 slug → `NODE_NOT_FOUND`. 비멤버(spring 멤버) `wrong_note_list('aws')` → `ROOM_NOT_FOUND`. PENDING → `viewer: "pending"`, rounds 없음.
7. `wrong_note_master(on)` → `mastered=true`, 목록 `mastered` 반영, `totals.mastered=1`; 그 문항 연습해도 `mastered_at` 유지; `off` → null. 잠긴 문항 → `WRONG_NOTE_LOCKED`.
8. 리프 보관(`node_archive`) → 목록에서 빠짐. 시험 문항 교체(`exam_unpublish` 가능한 경우)로 문항이 사라지면 `exam_practice` cascade.
9. `wrong_note_mine()`: 지은이 aws·spring 두 방에서 각각 오답 → `studies.length` = 참가 방 수(시험 없는 방도 `hasExam:false` 로 포함), aws 의 `rounds` 가 `wrong_note_list('aws').rounds` 와 **deepEqual**, 순서 = `me_studies` 순, PENDING 방·보관 방 없음, 비로그인 `AUTH_REQUIRED`.

**vitest(순수)** — `src/components/my-study/wrongNote.test.ts`: 필터 3종·외움 토글 적용, totals 문구, 빈 상태 분기(§6.2 표 5줄), 잠금 카드 문구(「10.28 마감 뒤에 열려요」), 묶음 채점 요약 문구, `stripKey(q)` 가 `answer`·`explanation` 키를 **지운다**(`"answer" in q === false`).

**vitest(DOM)** — `tabs/WrongNoteTab.dom.test.ts`(`ExamSection.dom.test.ts` 패턴: `vi.mock("@/lib/api/wrongNote")`): 목록 렌더(회차 h3·시험 카드·문항 번호), 기본 상태에 「정답」 태그 없음 → details 열면 있음, [다시 풀기] → take 입력 → [채점] 호출 인자 `[{questionId, answer}]` → 결과 배지·해설 펼침, 묶음 모드 하단 막대 「n/m 답함」·채점 1회 호출, [외웠어요] → 항목 사라짐·토글로 복귀, 잠금 카드에 버튼 없음, 오류 토스트 + 재조회. `StudyHeaderInfo.dom.test`·`MyStudyScreen.dom.test` TABS 길이 7·마지막 「오답노트」, `routes.test` 화이트리스트에 `wrong`.

**vitest(DOM, `/tasks`)** — `tasks/TasksScreen.notes.dom.test.ts`: `?view=notes` 로 마운트하면 `fetchWrongNoteMine` 호출·과제 툴바 필터(기간·묶기·유형·완료 숨기기) 숨김·스터디 칩 유지, `?study=aws` 면 aws 섹션만, 「오답노트 ›」 링크 href = `routes.myStudyTab("aws","wrong")`, Seg 전환이 `replaceState` 로 `?view=notes` 를 넣고 빼는지(`filterQuery` 테스트에 `view` 추가), 과제 보기로 갔다 와도 재요청 없음, 다시 풀기 호출에 그 카드의 slug 가 들어가는지.

**시나리오(ego-browser, 로컬 supabase, 마스터 계정)** — aws 3주차 시험 제출(2문항 틀림) → 오답노트 탭 → 해설 토글 → 문항 다시 풀기 → 시험 묶음 다시 풀기 → 외웠어요/되돌리기 → `after_deadline` 시험 잠금 카드 → `/tasks` 에서 「오답노트」 전환 → 스터디 칩으로 aws 만 → 같은 문항 다시 풀기 → 「오답노트 ›」 로 방 탭 이동 → 390/820/1440 스크린샷.

---

## 9. 단계

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| **1 (v1)** | 0046 · 탭 · 목록(회차별·잠금) · 해설 토글 · 문항/시험 다시 풀기(서버 채점·기록) · 외웠어요 · 필터 · **`/tasks` 「오답노트」 보기(전 스터디, 스터디 칩 연동)** | 지은이 3주차 시험에서 틀린 2문항을 오답노트에서 보고 다시 풀어 맞히면 배지가 바뀌고, 공식 점수는 그대로. 마감 전 `after_deadline` 시험은 잠금 카드. `/tasks?view=notes&study=aws` 에서 같은 문항을 다시 풀 수 있다 |
| 2 | 간격 반복 · 오답으로 새 시험 만들기(편집자) · 연습 시도 로그 · 재채점(시험 스펙 2단계) 시 노트 자동 동기화 확인 · `/tasks` 요약 줄에 「오답 n문항」 | — |

---

## 10. 위험 · 미확인

- `exam_reveal_ok(x, n, a)` 의 `a` 인자는 행 전체(`public.exam_attempts`)다 — 목록 조인에서 행 변수로 넘기는 plpgsql 루프 또는 `row(...)::public.exam_attempts` 캐스트가 필요. PGlite 에서 복합형 인자 호출이 되는지 Task 1 Step 1 에서 먼저 확인(0037 테스트가 이미 통과하므로 될 것).
- 재귀 CTE 로 회차를 찾는 비용: 사용자 1명 × 방 1개 × 시험 수(≤ 수십) — 문제 없음. `ix_exam_attempts_user` 추가로 `user_id` 선행 조회를 받친다.
- 시험 스펙 2단계 "정답 정정·재채점" 이 들어오면 `is_correct` 가 바뀌어 노트 소속이 자동으로 바뀐다(D1 유도 설계의 의도). 그때 `exam_practice` 행은 남지만 조인에서 빠질 뿐이라 정리는 불필요.
- `MyStudyScreen.tsx` 는 exam-results-card 가 수정 중 — 탭 분기 1줄은 그 커밋 뒤에 얹는다(Task 4).
- 탭이 7개가 되면 390 에서 「오답노트」 가 첫 화면 밖으로 밀릴 수 있다. 사용자가 발견성을 문제 삼으면 개요 탭 「이번 회차」 카드에 「오답 n문항 →」 링크(2단계 후보).
- `/tasks` 는 `TasksScreen.tsx`(약 300줄) 에 보기 전환이 들어간다 — 오답노트 보기 본문은 `tasks/TasksNotesView.tsx` 로 떼어 `TasksScreen` 은 Seg·분기만 늘어나게 한다. `calc.ts` 의 `TasksFilter` 에 `view` 가 들어가므로 `parseFilter`·`filterQuery`·`normalizeFilter` 테스트(`calc.test.ts`)를 함께 고친다.
- `wrong_note_mine` 은 방 수 × (재귀 CTE + 조인) — 사용자당 참가 방은 수 개라 문제 없지만, `statement_timeout` 확인 항목에 넣는다(플랜 Task 8).
