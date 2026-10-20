# 추가 모집 · 초대 코드(바로 참가) 설계

- 작성: 2026-10-20
- 요청(원문): "이미 시작한 스터디에 참가자 추가하고 싶은데, 추가 모집 기능이 없어. 추가 모집 하기위해 모집 기간을 설정하거나, 초대 코드를 통해서 이미 모집 종료되었더라도 초대 코드로 들어오면 참가 가능한 형태가 필요해"
- 플랜: `docs/superpowers/plans/2026-10-20-extra-recruit.md`
- 마이그레이션: `0032_extra_recruit.sql`(§10)
- 개정: 2026-10-20 Codex 플랜 리뷰 1차(9건) 반영 — 실효 마감(종료일로 자르기)·tick 재판정·재개 시 정리·내 스터디 노출·편집 미리보기·최소 인원·실패만 기록·폼 동기화·실 DB 경쟁 테스트(§3·§4.6·§6·§7·§11)

---

## 1. 현재 상태 (2026-10-20, 호스티드 DB = 0031)

| 영역 | 지금 동작 | 근거 |
|---|---|---|
| 방 생애 | `DRAFT → RECRUIT → ACTIVE → ENDED`(+ `archived_at` 보관). RECRUIT→ACTIVE 는 `room_tick`(5분 cron, `start_date ≤ today`) 또는 "지금 시작" | 0004 `room_tick`·`room_start`, 0013 `room_transition_active` |
| 참가 관문 | 모든 참가 경로가 `room_join_precheck` 의 `r.status <> 'RECRUIT' → ROOM_NOT_RECRUITING` 한 줄에 막힌다. 승인·거절(`room_decide_precheck`)도 RECRUIT 전용 | 0005 |
| 시작 시 대기 신청 | RECRUIT→ACTIVE 순간 PENDING 전부 `EXPIRED` + `JOIN_EXPIRED` | 0013 |
| 정원 | `member_count`(ACTIVE, 그룹장 포함) 원자 증감 `room_take_seat`. 진행중에도 `maxMembers` 는 늘릴 수 있다(room_update 잠금 목록에 없음). `joinMode`·`isPublic` 은 진행중 잠김 | 0004 · 0018 `room_update` |
| 초대 | **이미 있다.** 방당 활성 토큰 1개(`room_invites`, 32hex), `/invite/{token}` 랜딩(`InviteScreen`), 그룹장 패널 "초대 링크 복사 / 새 링크로 바꾸기". 비공개 방 열람 + 참가/신청 경로. 그러나 참가는 결국 `room_join`/`room_apply` → precheck 라 **RECRUIT 에서만** 된다(진행중이면 랜딩이 "이미 진행 중인 스터디예요") | 0004 `invite_ensure` · 0005 `invite_*` · 0024 `invite_join` |
| 짧은 코드 | 없음. 링크만 | — |
| 목록 | `rooms_list` 상태 필터 `recruit/active/ended`, 카드 `isFull = RECRUIT ∧ 꽉 참` | 0024 `rooms_list` · 0004 `room_matches` |
| 공통 과제 배정 | `assignment_resync` 가 **보관 안 된 모든 COMMON 리프 × ACTIVE 멤버**를 채운다 — 날짜 무관. 진행중에 누가 들어오면 이미 끝난 회차 과제까지 배정돼 곧바로 `missed`(미제출)로 잡히고 팀 달성률이 떨어진다 | 0014 |
| 이탈 | 진행중 멤버는 참가 취소 불가(`room_leave` = RECRUIT 전용) → 탈퇴 요청(0024 D3) → 그룹장이 이탈 처리(`INACTIVE`). `INACTIVE` 는 재참가 불가(`MEMBER_NOT_ACTIVE`) | 0005 · 0024 · 0027 |

**요약**: 초대 링크 인프라는 있지만 "진행중 방에 사람을 들이는" 경로가 DB 한 줄(`status <> 'RECRUIT'`)로 전부 막혀 있고, 막힘을 풀면 중간 합류자에게 지난 과제가 배정되는 문제가 따라온다.

---

## 2. 목표 · 비목표

**목표**
1. **추가 모집**: 그룹장이 진행중 방에 "마감일(+ 정원·참가 방식)"을 정해 모집 창을 연다. 창이 열린 동안 공개 방이면 둘러보기에 "추가 모집" 으로 보이고, 기존 참가/신청·승인 흐름을 그대로 탄다. 마감일이 지나면 자동으로 닫힌다.
2. **초대 코드(바로 참가)**: 그룹장이 기존 초대에 "모집이 끝나도 이 초대로 바로 참가"를 기한(+ 인원 한도)과 함께 켠다. 링크(`/invite/{token}`) 또는 8자 코드(`/join` 에서 입력)로 들어온 사람은 모집 상태·참가 방식과 무관하게 바로 참가한다.
3. **중간 합류자 공정성**: 진행중에 들어온 사람은 **합류일 이후 마감인 공통 과제만** 맡는다. 지난 기록은 볼 수 있다.

**비목표(v1)**
- 방당 초대 여러 개(사람별 1회용 코드 등) — I10 "방당 활성 초대 1개" 유지(D7 대안 C).
- 이탈 처리(`INACTIVE`)된 멤버 복귀.
- 종료(`ENDED`)·보관된 방 참가.
- 추가 모집 이력 표(창을 몇 번 열었는지) — 현재 창 하나만 기록.

---

## 3. 핵심 모델

### 3.1 "모집 열림" 판정 하나로 통일

```
room_recruit_until(r) := case when r.status = 'ACTIVE' and r.recruit_until is not null
                              then least(r.recruit_until, r.end_date) end      -- 실효 마감
room_recruit_open(r)  := r.archived_at is null and (
     r.status = 'RECRUIT'
  or coalesce(room_recruit_until(r) >= kst_today(), false))
```

- **실효 마감 = `least(recruit_until, end_date)`.** 종료일을 모집 마감보다 앞당겨도(진행중 `room_update`) 저장값은 그대로 두고 판정·표시에서 자른다. 종료일이 지나면 tick 전이라도 닫힌다.

- `rooms.recruit_until date` (KST, 포함) — **방 상태는 ACTIVE 그대로**(D1). 회차·알림·통계 등 ACTIVE 에 걸린 로직을 하나도 건드리지 않는다.
- `room_join_precheck`·`room_decide_precheck` 의 `status <> 'RECRUIT'` 를 `not room_recruit_open(r)` 로 바꾼다 → 추가 모집 창 안에서는 `room_join`·`room_apply`·`room_approve`·`room_reject` 가 그대로 동작. 창 밖 진행중 방은 지금과 똑같이 `ROOM_NOT_RECRUITING`(기존 테스트 유지).
- 창이 닫히는 순간 남은 PENDING → `EXPIRED` + `JOIN_EXPIRED`(D4) — RECRUIT→ACTIVE 때와 같은 규칙. 닫히는 경로 셋:
  1. **수동 마감**(그룹장 "지금 마감") — 방 행 잠금 안에서 바로.
  2. **자동 만료**(5분 tick) — 후보는 잠금 없이 고르되, 닫기 전에 **방 행을 잠그고 최신 상태로 다시 판정**한다. 그 사이 그룹장이 연장·재개했으면 손대지 않는다. tick 은 ACTIVE→ENDED 전이 **뒤**에 창을 정리해, 이번 tick 에 막 끝난 방(종료일 단축 포함)의 대기 신청도 같은 트랜잭션에서 만료한다.
  3. **재개 시 정리** — 실효 마감이 지났는데 tick 전에 그룹장이 다시 열면, 새 창을 열기 전에 옛 창의 PENDING 을 먼저 만료한다(옛 신청이 새 창으로 넘어가 승인되는 일 없음). 아직 열린 창을 연장하면 대기 신청은 유지.
- 지난 창의 PENDING 은 tick 전이라도 승인·거절할 수 없다(`room_decide_precheck` 가 같은 판정).

### 3.2 초대 = 기존 방당 1개 + 속성 3개

`room_invites` 에 열 추가:

| 열 | 뜻 |
|---|---|
| `code varchar(8)` unique | 8자 Crockford base32(`0-9A-Z` 에서 `I L O U` 제외, 32자 = 40bit). 입력은 대소문자·하이픈·공백 무시, `O→0`, `I/L→1` 로 정규화 |
| `bypass_until date` | 이 날짜(KST, 포함)까지 "바로 참가" 허용. null = 꺼짐 |
| `bypass_max int` | 바로 참가 인원 한도(1~100). null = 정원까지 |
| `bypass_used int` | 바로 참가로 들어온 수 |

- `invite_bypass_ok(i, r)` := 회전 안 됨 ∧ `least(bypass_until, end_date) ≥ today`(실효 기한 — 종료일 단축을 따른다) ∧ (한도 없음 ∨ `used < max`) ∧ 방이 RECRUIT·ACTIVE ∧ 보관 아님. 화면·응답의 기한도 실효 기한.
- `invite_join` 판정 순서: **바로 참가 유효 → `room_join_by_invite`(승인 없이 ACTIVE)** / 아니면 지금과 같음(`join_mode` 따라 `room_join`/`room_apply` → precheck 가 모집 열림 판정).
- 바로 참가도 **정원은 지킨다**(`ROOM_FULL`) — 그룹장이 정원을 늘린다(D3).
- 회전(`invite_rotate`) = 새 토큰·새 코드·바로 참가 꺼짐. 이미 퍼진 링크·코드가 한 번에 죽는다.
- 기존(0032 전) 초대 행은 `bypass_until = null` → **동작 변화 없음**. 이미 공유된 모집 링크가 진행중 방에 갑자기 열리는 일은 없다(D7).

### 3.3 중간 합류자 배정 시작일

- `room_members.assign_from date` — 방이 ACTIVE 일 때 ACTIVE 가 되는 경로(`room_join`·`room_approve`·`room_join_by_invite`)가 `kst_today()` 를 넣는다. RECRUIT 단계 합류·기존 행은 null(= 처음부터, 지금과 같음).
- `assignment_resync` 1단계(공통 과제 채우기)에 `and (m.assign_from is null or n.end_date >= m.assign_from)` 한 줄. 오늘 열려 있는 과제(마감 ≥ 오늘)·앞으로의 과제는 배정, 이미 마감된 과제는 배정 안 함(D6).
- 지정 과제는 지금처럼 그룹장이 직접 정한다(지난 과제에 지정해도 막지 않음 — 그룹장 판단).
- 개인 목표는 제약 없음(지금 규칙 그대로).
- **편집 미리보기도 같은 규칙**: `curriculum_get` 멤버에 `assignFrom` 을 싣고, 진행목표 편집의 공통 담당 재계산(`model.ts`)이 `기존 담당 ∪ (assignFrom 없음 ∨ 마감 ≥ assignFrom)` 을 쓴다. 공통 과제의 날짜만 바꿔도 중간 합류자가 있으면 다시 계산한다(서버 `node_update → assignment_resync` 가 새로 배정하므로). 미리보기 = 저장 결과.

---

## 4. 사용자 흐름

### 4.1 그룹장 — 방 설정 「추가 모집 · 초대」 섹션 (진행중·모집중 방)

알림 설정 섹션처럼 **바로 저장**(방 정보 폼 저장 막대와 따로). 진행중일 때 추가 모집 카드, 모집중·진행중일 때 초대 카드. 종료·보관이면 섹션 없음.

```
390px                                           ┌──────────────────────────────────────┐
┌──────────────────────────────────────┐       │ 추가 모집 · 초대                       │
│ 추가 모집 · 초대                       │       │ ┌──────────────────────────────────┐ │
│ 진행중에도 새 참가자를 받을 수 있어요     │       │ │ 추가 모집  ● 10/27(화)까지 · 승인제 │ │
│ ┌──────────────────────────────────┐ │       │ │ 4/6명 · 승인 대기 1명              │ │
│ │ 추가 모집                 꺼짐    │ │       │ │ [기간·정원 바꾸기]  [지금 마감]     │ │
│ │ 마감일   [2026-10-27 ▾]          │ │       │ └──────────────────────────────────┘ │
│ │          오늘~11/19 중 (최대 30일) │ │  ───▶ │  (열린 뒤)                            │
│ │ 정원     [ 6 ]명  지금 4명        │ │       └──────────────────────────────────────┘
│ │ 참가 방식 (●) 승인 후 참가         │ │
│ │          ( ) 바로 참가             │ │
│ │ 공개 방이라 둘러보기에 '추가 모집'    │ │
│ │ 으로 보여요. 들어온 사람은 오늘 이후  │ │
│ │ 마감인 공통 과제부터 맡아요         │ │
│ │ [ 추가 모집 시작 ]  (h-11, 전체폭)  │ │
│ └──────────────────────────────────┘ │
│ ┌──────────────────────────────────┐ │
│ │ 초대 코드                          │ │
│ │   K7QM-3XPA          [코드 복사]   │ │   ← 32px mono, 줄바꿈 없음
│ │ [🔗 초대 링크 복사]  새 코드로 바꾸기 │ │
│ │ ─────────────────────────────── │ │
│ │ 모집이 끝나도 이 초대로 바로 참가 [○] │ │   ← Switch
│ │   기한  [2026-10-27 ▾]            │ │   (켜면 펼침, 기본 오늘+7)
│ │   인원  [   ] 명까지 (비우면 정원까지)│ │
│ │   지금 0명 사용 · 승인 없이 바로 참가 │ │
│ │   [ 저장 ]                         │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

- 정원 칸은 위 방 정보 폼의 "최대 인원"과 같은 값 — 추가 모집 시작이 성공하면 폼 기준값의 `maxMembers` 도 갱신(다른 칸의 미저장 수정은 유지).
- 빈자리 0이면 시작 버튼 대신 "빈자리가 없어요 · 정원을 늘려 주세요"(서버 `CAPACITY_NO_SEAT`).
- 비공개 방: 안내 문구가 "목록에는 안 보여요 · 초대 링크·코드를 받은 사람만 참가할 수 있어요".

### 4.2 그룹장 패널(방 보기·내 스터디)

- 상태 배지 옆에 `추가 모집 ~10/27` 칩(열려 있을 때).
- 초대 행: `[초대 링크 복사] [코드 K7QM-3XPA 복사]` + 안내 한 줄
  - 진행중·창 닫힘·바로 참가 꺼짐: "진행중이라 지금은 이 링크로 참가할 수 없어요 · 방 설정에서 추가 모집이나 바로 참가를 켜 주세요 →"
  - 바로 참가 켜짐: "10/27까지 이 링크·코드로 바로 참가할 수 있어요"
- 승인 대기 목록: `모집 열림 ∧ 승인제` 또는 대기자가 남아 있을 때(진행중 포함).

### 4.3 참가자 — 둘러보기·방 보기

- 카드: 상태 배지 `진행중` + 보조 배지 `추가 모집`(파랑 계열, 모집중 배지와 같은 색) · 꽉 차면 `정원 마감`.
- 상태 필터 "모집중"이 추가 모집 중인 진행중 방도 포함(D5).
- 방 보기 참가 카드: `참가하기`/`참가 신청` + 안내 "진행중인 스터디예요 · 오늘 이후 마감인 과제부터 함께해요 · 10/27까지 모집".
- 진행중 참가자는 참가 취소 대신 탈퇴 요청(지금 규칙, D12) — 참가 버튼 아래 한 줄로 미리 알린다.

### 4.4 초대 랜딩 `/invite/{token}` (기존 화면 확장)

```
390px
┌──────────────────────────────────────┐
│ 스터디 초대                            │
│ 민수 님이 초대했어요                    │
│ ┌──────────────────────────────────┐ │
│ │ AWS SAA 자격증 3개월 완주  [진행중]  │ │
│ │ IAM부터 고가용성 아키텍처까지 …       │ │
│ │ 기간   10/1 ~ 12/31                │ │
│ │ 인원   4 / 6명 · 승인제             │ │
│ │ 그룹장 (민) 민수                    │ │
│ └──────────────────────────────────┘ │
│ ┌ ℹ 진행중인 스터디예요 ─────────────┐ │
│ │ 오늘 이후 마감인 과제부터 함께해요.   │ │
│ │ 지난 회차 기록은 볼 수 있어요.       │ │
│ │ 초대로 바로 참가 · 10/27까지         │ │
│ └──────────────────────────────────┘ │
│ [        바로 참가하기        ]  h-12 │
└──────────────────────────────────────┘
```

CTA 결정(`inviteActionOf`, 서버 `invite_preview.join` 을 따른다):

| 조건 | CTA |
|---|---|
| 비로그인 | `join.mode` 가 null 이면 닫힘 상태(종료·진행중·정원), 아니면 "로그인하고 참가"(returnTo = 이 랜딩) |
| 그룹장 / ACTIVE / PENDING / INACTIVE | 지금과 같음 |
| `join.mode = 'direct'` | "바로 참가하기"(바로 참가 초대면) / "참가하기" |
| `join.mode = 'approval'` | 한마디 + "참가 신청" |
| `join.mode = null` | 종료 → "종료된 스터디예요", 진행중 → "모집이 끝났어요 · 그룹장에게 새 초대를 받아 주세요", 정원 → "정원 마감" |

### 4.5 코드 입력 `/join`

```
390px
┌──────────────────────────────────────┐
│ 초대 코드로 참가                        │
│ 그룹장에게 받은 8자리 코드를 넣어 주세요   │
│ ┌──────────────────────────────────┐ │
│ │  K7QM-3XPA                        │ │  ← inputMode="text" autoCapitalize="characters"
│ └──────────────────────────────────┘ │     autoComplete="off", 4자 뒤 하이픈 자동
│ (오류) 맞는 코드가 없어요 · 9번 더 시도할 수 있어요 │
│ [           다음           ]           │
└──────────────────────────────────────┘
```

- 로그인 필수(`PROTECTED_PREFIXES` + `RETURN_TO_PREFIXES` 에 `/join`). 비로그인 → `/login?returnTo=/join` → 돌아와 입력. `?code=` 가 붙어 오면 칸을 채워 둔다(사용자가 [다음]).
- 성공하면 `/invite/{token}` 으로 이동 — 미리보기·CTA 는 랜딩이 한다(로직 한 곳).
- 진입점: 헤더 계정 메뉴 "초대 코드 입력", 홈 '참가한 스터디' 빈 상태 링크.
- 로그인 복귀: 비로그인 `/join?code=…` → 프록시가 `/login?returnTo=/join?code=…` 로 보낸다 → 로그인 뒤 같은 주소로 돌아와 칸이 채워진다(실행 테스트로 고정).

### 4.6 내 스터디 목록 (`me_studies`)

- 추가 모집 창에 신청해 승인 대기 중인 방은 사이드바 **"모집중 · 승인 대기"** 묶음에 보인다(모집중 방 신청과 같은 묶음, D14). 날짜 문구는 `MM.DD 모집 마감`(실효 마감). 창이 닫히면(만료) 목록에서 빠진다 — 모집중 방 신청이 시작 때 만료되면 빠지는 것과 같다.

---

## 5. 알림

| 언제 | kind | 받는 사람 | 비고 |
|---|---|---|---|
| 추가 모집 창에서 승인제 신청 | `JOIN_REQUESTED`(기존) | 그룹장 | 링크 `#applications` (기존) |
| 승인·거절 | `JOIN_APPROVED`/`JOIN_REJECTED`(기존) | 신청자 | |
| 창 닫힘 시 대기 만료 | `JOIN_EXPIRED`(기존) | 신청자 | dedupe prefix `JOIN_EXPIRED:{room}:extra:{txid}` — 시작 때 만료된 사람이 다시 신청했다 만료돼도 알림이 간다 |
| **진행중 방에 바로 참가**(추가 모집 바로 참가·초대 바로 참가) | **`MEMBER_JOINED`(신규)** | 그룹장 | 제목 `{닉}님이 {방}에 합류했어요`, 본문 `추가 모집으로 참가했어요` / `초대로 바로 참가했어요` + ` · 지정 과제 담당이 필요하면 진행목표에서 정해 주세요`. 링크 = 그룹장 기본(`/my-study/{slug}`, `notify_link` 무변경). 설정 토글 없음(`notify_enabled` else true) |
| 모집 단계(RECRUIT) 바로 참가 | 없음(지금과 같음) | | |
| 팀원에게 | 없음(D11) | | 멤버 목록에 바로 보인다 |

---

## 6. 보안 · 남용 방지

- **링크 토큰** 128bit(uuid hex) — 지금 그대로, 추측 불가. 비로그인 미리보기 허용(지금 그대로).
- **코드** 40bit. 조회 RPC `invite_code_lookup` 은 **로그인 필수** + 사용자별 실패 10회/1시간(`invite_code_failures`). 실패는 예외를 던지지 않고 `{found:false, remaining}` 을 **반환**한다 — `public.fail` 로 던지면 실패 기록 INSERT 까지 롤백돼 제한이 무력해진다(Review Focus). 한도 초과만 `RATE_LIMITED` 로 던진다(기록할 것이 없다).
  - **실패만 저장**한다. 성공·회전 코드 적중은 기록하지 않는다(아는 코드를 반복 조회해도 행이 쌓이지 않음). 1일 지난 실패는 5분 tick(`room_tick`)이 지운다 — 다시 방문하지 않는 계정의 기록도 남지 않는다.
  - 활성 코드 1만 개 가정 시 1회 적중 확률 ≈ 1e4 / 32^8 ≈ 9e-9, 계정당 하루 최대 240회.
  - **한계(명시)**: 제한은 사용자별이다. 여러 계정으로 나눠 시도하는 공격은 이 기능이 막지 않는다(계정 수에 비례해 시도 횟수가 늘어난다). 필요해지면 요청·IP 단위 제한(Edge/프록시 레벨)을 별도로 설계한다 — v1 범위 밖.
- 코드·토큰·바로 참가 설정은 **그룹장만** 본다(`room_detail_json.invite` 는 그룹장에게만, `invite_get`·`invite_bypass_set` 은 `require_leader`). 위임 편집자 불가.
- 바로 참가 남용 상한: 기한 최대 30일 ∧ 방 종료일 이전, 인원 한도(선택), 정원. 퍼졌으면 "새 코드로 바꾸기" 한 번에 무효.
- 회전된 코드로 조회하면 `found:true` 로 랜딩에 보내고 랜딩이 "더 이상 쓸 수 없는 초대 링크예요"(INVITE_REVOKED) — 실패 횟수에 넣지 않는다.

---

## 7. 경계 사례

| 사례 | 처리 |
|---|---|
| 종료·보관 방 | 추가 모집 열기 `ROOM_STATUS_INVALID`. 바로 참가 판정 거짓 → 랜딩 닫힘 CTA. 보관 중 열린 창은 판정이 거짓(보관 풀면 다시 참) |
| 종료일 단축으로 `recruit_until > end_date` | 판정·표시가 실효 마감(`least(recruit_until, end_date)`)을 쓴다 → 종료일이 지나면 tick 전이라도 닫힘. 종료일 다음 tick 이 종료 전이와 대기 만료를 **같은 트랜잭션**에서. 바로 참가 기한도 `least(bypass_until, end_date)` |
| 마감 뒤 tick 전에 그룹장이 다시 엶 | 옛 창의 PENDING 을 먼저 만료(+알림)하고 새 창을 연다 |
| tick 이 후보를 고른 뒤 그룹장이 연장 | 자동 만료가 방 행을 잠근 뒤 재판정 → 연장된 창은 그대로 |
| 새 정원 < 최소 인원 | `VALIDATION_FAILED {field:'maxMembers', minMembers}`(원시 제약 오류 아님) |
| 이미 PENDING 인 사람이 바로 참가 초대를 받음 | 바로 ACTIVE 로 승격(승인 불필요). 그룹장 대기 목록에서 사라짐 |
| REJECTED·CANCELED·EXPIRED | 추가 모집 창에서 다시 신청/참가 가능(지금 규칙). 바로 참가 초대로도 가능 |
| INACTIVE(이탈 처리) | 추가 모집·바로 참가 모두 `MEMBER_NOT_ACTIVE`(D12) |
| 그룹장 본인 | `OWNER_CANNOT_JOIN` |
| 정원 가득 | 추가 모집: 창 유지 + 카드 `정원 마감`. 바로 참가: `ROOM_FULL` "정원이 찼어요 · 그룹장에게 정원을 늘려 달라고 해 주세요" |
| 비공개 방 추가 모집 | 목록 비노출. `/rooms/{slug}?invite=` · 랜딩 · 코드로만 진입(지금 규칙) |
| 동시 바로 참가(한도 1명 남음) | `room_lock`(방 행) → 초대 행 `for update` → 재판정 → 좌석 → `bypass_used+1`. 둘째 요청은 `INVITE_EXPIRED` |
| 중간 합류자 참가 취소 | 진행중이므로 불가 → 탈퇴 요청(D12) |
| 회차가 이미 모두 끝난 진행중 방 | 배정 0건. 그룹장이 새 과제를 만들면 그때부터 배정 |
| AI 계획서(0034)로 지난 날짜 공통 과제를 새로 만듦 | 중간 합류자에게는 배정되지 않음(같은 `assignment_resync` 규칙) |

---

## 8. 결정 (D1~D14)

각 항목 **권장안**과 대안. 사용자 승인 전까지 권장안 기준으로 플랜을 쓴다.

| # | 질문 | 권장 | 대안 |
|---|---|---|---|
| D1 | 추가 모집을 상태로? | **ACTIVE 유지 + `rooms.recruit_until`** — 진행 로직 무변경, 판정 함수 하나 | B) RECRUIT 로 되돌림(회차 알림·통계·tick 이 다 꼬임 ✗) · C) `recruit_windows` 이력 표(이력 화면 생기면) |
| D2 | 추가 모집 참가 방식 | **열 때 고른다(기본 = 지금 방식), `rooms.join_mode` 갱신** | B) 항상 승인제 · C) 방 방식 고정(진행중 잠금 유지) |
| D3 | 정원 | **열 때 정원도 함께(원자적), 빈자리 0이면 열기 거부. 꽉 차도 창은 유지(`정원 마감` 표시, 자리 나면 다시 참가 가능)** | B) 차면 창 자동 마감 · C) 정원은 방 정보 폼에서만 |
| D4 | 창 닫힐 때 대기 신청 | **EXPIRED + JOIN_EXPIRED**(시작 때와 같은 규칙, 대기 목록이 쌓이지 않음) | B) 남겨 두고 그룹장이 계속 처리(진행중 승인 허용 범위가 넓어짐) |
| D5 | 둘러보기 노출 | **"모집중" 필터에 포함 + 카드 보조 배지 `추가 모집`**, 정렬은 그대로 | B) 별도 필터 칩 · C) 진행중으로만 보이고 상세에서만 안내 |
| D6 | 중간 합류자 공통 과제 | **합류일 이후 마감 과제만(`assign_from`)** — 미제출 낙인·달성률 왜곡 없음 | B) 전부 배정(지금 동작 그대로 열면 이렇게 됨) · C) 현재 회차부터(회차 경계 계산 필요) |
| D7 | 초대 우회 모델 | **기존 방당 1개 초대 + "바로 참가" 속성(기한 필수 ≤30일, 인원 선택)**. 기존 링크는 자동으로 열리지 않음 | B) 기존 링크가 진행중에도 무조건 통과(이미 퍼진 링크가 열림 ✗) · C) 초대 여러 개(사람별·1회용) 표 — v2 |
| D8 | 바로 참가 시 승인 | **승인 없이 바로**(그룹장이 기한·인원을 걸고 직접 연 경로) | B) 초대로 와도 승인 대기(그러면 추가 모집과 차이가 없음) |
| D9 | 코드 형식 | **8자 Crockford base32(40bit), `XXXX-XXXX` 표시, 로그인 후 입력, 실패 10회/시간** | B) 6자리 숫자(20bit — 제한이 있어도 약함 ✗) · C) 코드 없이 링크만 |
| D10 | 코드 입력 위치 | **`/join` 페이지 + 헤더 메뉴 + '참가한 스터디' 빈 상태** | B) 홈 상단 상시 입력칸(공간 비용) |
| D11 | 알림 | **`MEMBER_JOINED` 신규(그룹장, 진행중 바로 참가만)**, 팀원 알림 없음 | B) 팀원에게도 · C) 신규 kind 없이 생략 → AI 플랜과 `notification_kinds`·`notify_render` 충돌 0(§10) |
| D12 | 중간 합류자 취소·이탈자 복귀 | **취소 = 탈퇴 요청 경로, INACTIVE 복귀 불가(초대로도)** | B) 창 안에서는 참가 취소 허용(`room_leave` 재정의 필요) · C) 그룹장이 INACTIVE 복귀 허용(해제된 배정 복원 문제) |
| D13 | 합류 전 기록 열람 | **전부 열람**(제출물 포함 — 지금 ACTIVE 멤버 규칙 그대로) | B) 합류 전 제출물 숨김(`can_read_submission` 재정의) |
| D14 | 추가 모집 신청자의 내 스터디 묶음 (Codex #4 로 추가) | **"모집중 · 승인 대기" 묶음 + `MM.DD 모집 마감`** — 신청 상태가 같으면 같은 자리 | B) "진행중" 묶음에 대기 배지(방 상태 기준 묶음 유지) |

---

## 9. DB 변경 요약 (`0032_extra_recruit.sql`, 추가형)

| 종류 | 대상 |
|---|---|
| 열 | `rooms.recruit_until` · `room_members.assign_from` · `room_invites.code/bypass_until/bypass_max/bypass_used` (+ 체크·유니크 인덱스) |
| 표 | `invite_code_failures`(실패만, RLS on, 정책 없음, anon·authenticated 권한 회수, 1일 뒤 tick 정리) |
| 데이터 | 활성 초대 행에 코드 채우기(DO 루프, 기존 행 의미 무변경) |
| 새 함수(공개) | `room_extra_recruit_open(text, date, int, text)` · `room_extra_recruit_close(text)` · `invite_bypass_set(text, date, int)` · `invite_code_lookup(text)` → authenticated |
| 새 함수(내부) | `room_recruit_open` · `room_recruit_until` · `room_member_activate` · `room_extra_recruit_expire`(수동·재개, 호출자 잠금) · `room_extra_recruit_auto_expire`(tick, 잠금 후 재판정) · `room_join_by_invite` · `invite_code_new` · `invite_code_norm` · `invite_json` · `invite_bypass_ok` |
| 재정의(최신 판 복사) | `assignment_resync` ←0014 · `room_join_precheck` ←0005 · `room_join` ←0005 · `room_approve` ←0005 · `room_decide_precheck` ←0005 · `room_tick` ←0004 · `invite_ensure` ←0004 · `invite_get`·`invite_rotate`·`invite_preview` ←0005 · `invite_join` ←0024 · `room_detail_json` ←0026 · `rooms_list` ←0024 · `room_matches` ←0004 · `notification_kinds` ←0024* · `notify_render` ←0028* · `me_studies` ←0024 · `curriculum_json` ←0024 |

\* AI 플랜(0034)도 재정의 — §10.

재정의하지 않는 것: `room_apply`(precheck 가 관문), `room_leave`, `room_update`, `notify_link`, `notify_enabled`, `invite_resolve`, `room_transition_*`, `job_cleanup`(실패 기록 정리는 `room_tick` 에서).

`me_studies`·`curriculum_json` 은 AI 연동 플랜(0033~0035)이 재정의하지 않는다. 다만 AI 의 `api_studies` 가 `me_studies` 출력을 소비하므로 `when.kind = 'recruitEnd'`·진행중 방의 대기 항목이 새로 나타난다(함수 충돌 아님, 동작 상호작용).

---

## 10. 마이그레이션 번호 · AI 연동 플랜과의 충돌

- **선택됨(확정): AI 연동보다 먼저 배포 → `0032_extra_recruit.sql`.** AI 연동 플랜(`2026-10-19-ai-integration.md`)은 0033~0035 로 밀렸다.
- **함수 충돌(둘 다 재정의)**: `notification_kinds()`(AI 0034 ← 0032 판(MEMBER_JOINED 포함, 유지)에 `CURRICULUM_BULK_UPDATED` 추가) · `notify_render()`(AI 0034 ← 0032 판에 분기 추가). 그리고 TS `src/lib/api/types.ts` 의 `NOTIFICATION_KINDS` 배열(양쪽 다 끝에 추가).
- 충돌 아님(확인함): AI 가 재정의하는 `current_user_id`·`node_create`·`node_update`·`notify_link`(AI 목록에는 있으나 MEMBER_JOINED 는 기본 갈래로 충분해 이 기능은 재정의 안 함)·`pat_*`·`plan_*`·`api_*`·`curriculum_plan_*`·`personal_*_many` 는 이 기능이 건드리지 않는다. 이 기능이 재정의하는 `assignment_resync` 는 AI 가 **호출만** 한다(동작 변화: 중간 합류자에게 지난 날짜 공통 과제 미배정 — 의도된 일관성).
- **AI 보다 먼저 배포**(확정 → `0032_extra_recruit.sql`):
  1. 파일명·파일 머리 주석·테스트 파일 머리 주석·`cases("… 0032 …")` 묶음 이름·커밋 메시지의 번호 = `0032`.
  2. 이 기능의 `notification_kinds`·`notify_render` 복사 원본은 현재 `supabase/migrations/` 최신 판(0024/0028).
  3. AI 플랜은 0033~0035 로 밀렸고, AI 플랜의 `notification_kinds`·`notify_render` 복사 원본은 **`0032_extra_recruit`** 이다(`MEMBER_JOINED` 유지). AI 문서에 반영 완료.
  4. `NOTIFICATION_KINDS` 주석 `// 0032`.
- 호스티드 적용은 사용자 승인 후 사용자가(`supabase db push`).

---

## 11. 테스트 전략

- SQL(PGlite, `supabase/tests/extra-recruit-sql.test.ts`): 판정 함수 표, 추가 모집 열기·닫기·tick 만료, precheck/승인 창 안팎, 중간 합류 배정(aws 시드: 지난 COMMON `IAM 정책 이해`·`VPC 실습` 미배정, `ALB vs NLB 실습` 이후 배정), 바로 참가(기한·한도·정원·INACTIVE·PENDING 승격·회전), 코드 조회(정규화·실패 기록 유지·한도·회전 코드), 목록 필터·카드 필드, 알림, GRANT.
- 기존 테스트 수정 1곳: `_cases-membership.ts` "invite_get/rotate" 의 `invite_get` 전체 객체 단언 → 기존 3키 부분 단언 + `code` 형식.
- 웹(vitest): `closedAction`/`actionOf`/`inviteActionOf` 표, 코드 정규화·표시, 추가 모집 기본값·검증, `toRoomCard` 배지, DOM: 설정 섹션·랜딩 안내·`/join` 폼.
- SQL 추가(Codex): 재개 시 옛 대기 만료, 자동 만료 재판정, `room_update` 로 **실제** 종료일 단축 → 같은 tick 에서 종료 + 대기 만료, 최소 인원 검증, 실패만 기록·tick 정리, `me_studies` 노출, `curriculum_get.assignFrom`.
- **실 PostgreSQL 두 연결**(`supabase/tests/extra-recruit-db.test.ts`, 로컬 supabase 전용, URL 가드): 추가 모집 마지막 좌석 동시 참가(한쪽 `ROOM_FULL`), 바로 참가 한도 경쟁(한쪽 `INVITE_EXPIRED`), tick↔연장 경쟁(새 창 유지), 별도 요청(트랜잭션)에 걸친 실패 누적 → `RATE_LIMITED`. 배포 전 필수 게이트.
- 웹 추가: 편집 미리보기(`model.ts`) 중간 합류자 규칙 = 서버, 설정 폼 서버 칸 동기화(`syncServerFields`), 사이드바 "모집 마감", 로그인 복귀(`middleware.test.ts` 로 `/join?code=` 보존 실행).
- 브라우저(ego-browser, 390/820/1440): 그룹장 설정 → 추가 모집 시작 → 다른 계정 둘러보기 → 신청 → 승인 → 내 스터디에서 지난 과제 미배정 확인 / 바로 참가 켜기 → 코드 입력 → 바로 참가 / 비로그인 `/join?code=` → 로그인 → 복귀 / 종료일 단축 후 마감 표시.
