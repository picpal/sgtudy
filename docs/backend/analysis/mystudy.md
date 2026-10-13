# 내 스터디 (RoomDetail, `/my-study/[id]`) — 백엔드 요구 분석

> 대상: `src/components/my-study/**`, `src/data/my-study.ts`, `docs/specs/roomdetail.md`, `docs/claude-design-prompt.md` §2.2–§2.6, §4.5–§4.11.
> 기준일 TODAY = 2026-10-12(월), ME = 철수. 모든 날짜는 `YYYY-MM-DD`(KST 달력일), 마감 시각은 마감일 23:59:59 KST.
> 화면에는 5탭(개요·커리큘럼·보드·캘린더·간트) + "그룹장 편집 미리보기"만 있고, **설정 탭(§4.11)과 과제 상세·제출(§4.10)은 화면이 없다.** 그래도 이 문서는 두 화면이 요구하는 백엔드까지 포함한다(별도 화면 분석이 없으므로).

---

## 0. 도메인 모델 요약 (이 화면이 전제하는 것)

### 0.1 목표 트리
| 항목 | 규칙 | 근거 |
|---|---|---|
| 깊이 | 방 = 1단계. 트리 노드는 2~5단계. 프론트 `d`(0‑based) = 단계 − 2. UI는 `aria-level = d+2` | §2.2, `TreeRow.tsx:31` |
| 회차 | 2단계 노드(= 루트, `d=0`). `label`("1주차", "1–4주차")을 가진다. 3단계 이하 중간 노드는 `label=null` | `RawNode.label`, aws 3주차 "로드밸런서 비교" |
| 과제 | **말단(leaf)에만** 존재. 리프 = `type`(공통/지정) + 담당자. 부모는 집계만 | `isRawLeaf` = `"codes" in n` |
| 하위 추가 한도 | `d ≤ 2`인 부모만 "+" 가능 → 자식 `d=3`(5단계)까지. `d > 2`는 비활성 + "최대 5단계까지만 만들 수 있어요" | `TreeRow.tsx:25-27` |
| 기간 | 모든 노드가 `s`, `e`를 가진다(목업은 전부 채워져 있음). 회차 기간 = 캘린더 "회차 시작 마커"·간트 범위의 근거 | `RawNode.s/e`, `ganttRange` |
| 설명 | 모든 노드에 마크다운 설명(편집 패널에 textarea만 있고 바인딩 없음) | `EditPanel.tsx:70-73` |
| 공통 과제 | 담당자 = **활성 참가자 전원 자동**. 이탈자(도윤)는 `PLANS.members`에 없음 → 집계 제외 | `buildTree` `type==="공통"` 분기, §2.2 |
| 지정 과제 | 명시된 담당자만. 0명(“담당자 미정”) 허용. 모집중엔 경고 배너만 | sqld "2과목 기출 풀이 (전반)" `codes:"-"` |
| 보관 | 제출물 있는 노드는 삭제 불가 → 보관. 보관 노드는 집계·보드·캘린더에서 제외, 트리·간트엔 opacity .55로 남음 | `buildTree` `live` 필터, `leaves` 필터 |

### 0.2 사람별 상태 코드 (`Code`)
| 코드 | `TaskStatus` | 의미 | 판정 |
|---|---|---|---|
| D | done | 기한내 제출 | 제출 있음 ∧ 최초 제출 시각 ≤ 마감 |
| L | late | 지각 제출 | 제출 있음 ∧ 최초 제출 시각 > 마감 |
| M | missed | 미제출(경과) | 제출 없음 ∧ today > e |
| O | open | 진행중 | 제출 없음 ∧ s ≤ today ≤ e |
| P | planned | 예정 | 제출 없음 ∧ today < s |
| - | (없음) | 미배정 | 담당자가 아님 → `people`에서 제외 |

### 0.3 과제(리프) 상태 `LeafState` — `model.ts:92-98`, 순서 중요
```
asg == 0            → unassigned
sub == asg          → complete      (sub = D+L 수)
s > today           → planned
e < today           → delayed
else                → progress
```

---

## 1. 화면이 읽는 데이터 (Read model)

### 1.1 사이드바 "내 스터디" (`SIDEBAR_GROUPS`, `StudySidebar.tsx`)
| 필드 | 타입 | 출처 | 비고(목업) |
|---|---|---|---|
| group.label | enum 진행중 / 모집중 · 신청한 방 / 종료 | 방 상태 × 내 멤버십 상태 | 진행중=active ∧ joined, 모집중=recruit ∧ (joined ∨ pending), 종료=ended |
| item.id | room id | room | 현재 `RoomId` 유니온 → 실데이터는 slug/UUID |
| item.when | string | active: 내 다음 마감 `"10.14 마감"`; recruit: 시작일 `"10.26 시작"`; ended: 종료일 `"09.30 종료"` | 프론트 포맷 가능 → 원본 날짜 + kind 전달 권장 |
| item.left | number? | active만: `diffDays(today, 내 다음 마감 e)` | aws 2, spring 6. ≤2면 빨강 |
| title, intro | string | room | 카드 본문 |

### 1.2 상단 공통 + 개요 메타 (`StudyHeaderInfo.tsx`)
| 필드 | 타입 | 출처 | 비고 |
|---|---|---|---|
| title, intro | string | room.title / room.intro | |
| period | string | room.start_date, end_date → `"2026.10.01(목) – 12.31(목)"` | 포맷은 프론트 |
| dday | string | active: `dday(today, end)` / recruit: `dday(today, start)` / ended: "종료" | aws D-80, sqld D-14 |
| ddayLong | string | "종료까지 D-80" / "시작까지 D-14" / "09.30 종료" | |
| status | `recruit\|active\|ended` | room.status (+archived 는 이 화면에 안 보임) | 공용 |
| joinMode | string | room.join_mode: `direct`→"바로 참가", `approval`→"그룹장 승인 후 참가" | 공용 |
| visibility | string | room.is_public + join: "공개" / "비공개 · 초대 링크로만 참가" | 공용 |
| leader | string | room.leader → nickname | 아바타 색은 이름 기반(프론트) |
| tags[] | `{label, tone, auto}` | room_tag (+tag_dictionary.tone) | auto=true면 ✦ 표시 |

### 1.3 개요 탭 (`OverviewTab.tsx`)
| 필드 | 타입 | 출처 | 비고 |
|---|---|---|---|
| cur.pill | string | 현재 회차 = `s ≤ today ≤ e`인 루트 → `"{label} · 진행중"`; recruit → "시작 전"; ended → "종료" | 하드코딩 → 파생 |
| cur.title / meta | string | 현재 회차 title / `"10.08(목) – 10.14(수) · 마감 D-2"` | recruit: "{시작일} 첫 회차가 열려요" / "{회차 수}회차 · 과제 {리프 수}개 준비됨" |
| cur.tasks[] | `{title, type, dates, people:[name, TaskStatus][]}` | 현재 회차 아래 **보관 제외 리프**(모든 깊이) + 담당자별 상태 | 목업은 트리와 동일. "{subs}/{n} 제출" 또는 전원 planned면 "{s} 시작" |
| about | markdown | room.description | |
| rules | string[] | room.rules(마크다운) | 목업은 bullet 배열. §2.1은 마크다운 → **마크다운 저장, 프론트 렌더** 권장 |
| rounds[] | `{label,title,dates,state,sub,total,current,alt}` | 루트 노드 + 집계. `sub/total`은 **이미 트리 집계로 대체됨** (`OverviewTab.tsx:124-128`) | state: today<s 예정 / s≤today≤e 진행중 / e<today ∧ pct<100 "기간 종료" / 전원 제출 "완료". recruit는 alt="과제 N개" |
| moreRounds | string | 루트 수 − 표시 수 | 목업 "이후 10개 회차" ≠ 실제 5루트. 결정 필요(§7) |

### 1.4 참가 정보 카드 (`JoinInfoCard.tsx`)
| 필드 | 타입 | 출처 | 비고 |
|---|---|---|---|
| capCur / capMax | number | active 멤버 수(그룹장 포함, 이탈·대기 제외) / room.max_members | aws 4/6 (도윤 제외) |
| minText / minOk | string/bool | room.min_members: 충족 "최소 3명 · 충족", 미충족 "최소 3명 · 2명 더 필요해요", 정원이면 " · 정원 마감" 추가 | min 없으면 문구 생략 |
| overall | number\|null | `overallPct(roots)` = Σsub/Σasg (보관 루트 제외), asg 0이면 null → "시작 전" | aws 24 |
| members[] | `{name, leader, me, left, pending, noBar, done, total}` | room_member (status: active/left/pending) + `memberStats(leaves, name)` | 목업 done/total은 **무시되고 트리 집계 사용**. 대기자도 목록에 포함(sqld 철수) |
| noBar | bool | `(leader ∧ !room.leader_does_tasks) ∨ total==0` | sqld 가은 |
| action | `joined\|pending\|closed` | 내 멤버십: active → joined / pending → pending / 방 ended → closed | 공용(RoomView) |
| next | `{title, path, due, dday}\|null` | 내 담당 리프 중 코드 **O**(미제출·기간 내) 를 `e` 오름차순 → 첫 번째. 없으면 null | aws EC2 D-2, spring 섹션6~7 D-6. §7 결정: M(경과) 우선 여부 |

### 1.5 커리큘럼 트리 (`Plan` → `buildTree`)
프론트는 `Plan = {members: string[], tree: RawNode[]}`와 리프의 `codes`(멤버 순서 문자열)를 받아 전부 클라이언트에서 집계한다. 백엔드 DTO는 §6 참고. 화면이 필요로 하는 노드별 필드:

| 필드 | 타입 | 비고 |
|---|---|---|
| id | string | 목업 "0.1" 경로 id → 실제 UUID. 보드 회차 필터가 `id.split(".")[0]`을 쓰므로 **`roundId`(루트 id)를 별도 제공** |
| parentId, depth(d), sortOrder | | 전위 순서·들여쓰기 |
| label | string\|null | d=0만 |
| title, s, e, description, archived | | |
| leaf.type | 공통/지정 | |
| leaf.people[] | `{userId, name, code}` | 서버가 코드 계산(§3.1) |
| 파생(클라 가능) | asg, sub, state, pct, crumb, roundLabel | `buildTree`가 이미 계산. 서버도 같은 규칙으로 제공하면 검증·캐시에 유리 |

툴바: `overall%`, `과제 {leaves.length}개`, 경고 배너 `unassignedCount` = 지정 ∧ asg 0 ∧ 보관 아님 (sqld 1).

### 1.6 보드 / 캘린더 / 간트
전부 1.5 트리의 파생값만 쓴다(§3.4–§3.6). 추가 읽기 데이터 없음. 캘린더 참가자 필터 칩은 `tree.members`(활성 참가자, 나 제외).

---

## 2. 사용자 액션 → 백엔드 연산 (Write model)

공통 선행 조건: 모든 편집은 **그룹장만**(`FORBIDDEN_NOT_LEADER` 403). 방 상태 `archived`/`ended`는 편집 불가(`ROOM_NOT_EDITABLE` 409, §7 결정). 목업은 역할 체크 없이 "편집 미리보기"로 노출한다 → 실구현은 `role==leader`일 때만 세그먼트 노출.

### 2.1 커리큘럼 편집 (state.ts `Overrides` ↔ 서버 연산)

| # | 목업 오버라이드 / UI | 백엔드 연산 | 입력 | 검증 | 부수효과 |
|---|---|---|---|---|---|
| E1 | `added[parentId]` ← "+" 버튼 (`addChild`) | **노드 생성(하위)** `POST /nodes` `{parentId}` | title="새 과제", type=공통, s/e = 부모 s/e, 맨 뒤 | 부모 depth ≤ 4단계(`d ≤ 2`) 아니면 `NODE_DEPTH_EXCEEDED`; 부모가 **제출물 있는 리프**면 `NODE_HAS_SUBMISSIONS`(리프→부모 전환 불가); 제출물 없는 리프에 자식 추가 시 리프 속성(type/담당자) 제거 후 부모로 전환 | 응답에 새 id → 프론트 `editSel` |
| E2 | `added.root` ← "+ 회차 추가" (`addRound`) | **회차 생성** `POST /nodes` `{parentId:null}` | title="새 회차", label=`"{n}회차"`(n=루트 수+1), s = 마지막 회차 e+1, e = s+6 | 루트 수 제한 없음. label 중복 허용 | |
| E3 | `titles[id]` | **제목 수정** `PATCH /nodes/{id}` `{title}` | 1~80자 | 공백만 → `INVALID_TITLE` | 태그 재선택 대상 |
| E4 | `dates[id].s/e` | **기간 수정** `PATCH` `{startDate,endDate}` | `s ≤ e` 필수(`INVALID_PERIOD`). 부모 기간 밖·방 기간 밖은 **경고만**(§7) | 진행중 방이면 **일정 변경 알림**(담당자·활성 참가자). 마감 변경 시 지각 플래그는 재계산하지 않음(§2.3 "최초 제출 시점 기준 고정", §7) |
| E5 | 설명 textarea(바인딩 없음) | `PATCH` `{description}` markdown | ≤ 20k자 | |
| E6 | `typeOv[id]` 공통↔지정 (`setType`) | `PATCH` `{taskType}` | 리프만(`NODE_NOT_LEAF`). 지정 전환 시 담당자 초기값 = 전환 직전 `people`(= 전원) → 프론트가 `assigneeIds` 같이 보냄. 공통 전환 시 `assigneeIds` 무시·삭제 | 지정→공통: 명시 담당자 행 삭제 |
| E7 | `assignOv[id]` 칩 토글 | `PATCH` `{assigneeIds[]}` | 리프 ∧ type=지정. 각 id는 **활성 참가자**(그룹장은 `leader_does_tasks`일 때만) 아니면 `ASSIGNEE_NOT_MEMBER`. 0명 허용(모집중/진행중 모두; 경고만) | 진행중 방에서 추가된 사람 → **지정 과제 배정 알림**, 빠진 사람 → 재지정 알림. 제출물 있는 담당자 제거 시 `ASSIGNEE_HAS_SUBMISSION` 409 (§7) |
| E8 | 삭제 (`removed[id]`, 확인 다이얼로그) | `DELETE /nodes/{id}` | 자신 또는 **하위 어느 리프에든 제출물이 있으면** `NODE_HAS_SUBMISSIONS` 409 → UI는 보관 플로우 | 하위 트리 하드 삭제, 형제 sortOrder 재정렬 |
| E9 | 보관 (`archived[id]=true`) | `POST /nodes/{id}/archive` | 제출물 유무 무관하게 허용(UI는 제출물 있을 때만 노출) | 하위 전체 archived 전파. 집계·보드·캘린더·리마인더에서 제외. 제출물 보존 |
| E10 | 보관 해제 (확인 없이 즉시) | `POST /nodes/{id}/unarchive` | 부모가 보관 상태면 `PARENT_ARCHIVED` | 하위 전파 |
| E11 | 드래그 정렬 (핸들만 있음, 동작 없음) | `POST /nodes/{id}/move` `{parentId, index}` | 같은 부모 안 순서 변경. index 범위 검증 | |
| E12 | 들여쓰기 (§4.6, UI 없음) | 같은 `move` — `parentId` = 직전 형제, index = 끝 | 직전 형제 없으면 `NO_PREV_SIBLING`; 직전 형제가 제출물 있는 리프면 `NODE_HAS_SUBMISSIONS`; 이동 후 **서브트리 최대 깊이 ≤ 5단계** 아니면 `NODE_DEPTH_EXCEEDED` | 직전 형제가 리프였다면 부모로 전환(type/담당자 제거) |
| E13 | 내어쓰기 (§4.6, UI 없음) | 같은 `move` — `parentId` = 조부모, index = 부모 다음 | 루트(회차)는 내어쓰기 불가 `ROOT_CANNOT_OUTDENT`; 3단계→2단계가 되면 회차가 되므로 label 자동 부여 | 원 부모가 자식 0개가 되면 **리프(공통 과제)로 전환**되지 않고 "빈 부모"로 남김(§7) |
| E14 | "저장" 버튼 → "저장했어요 · 태그를 자동으로 다시 골랐어요" | 저장 단위 결정(§7). 권장: E3–E7은 **패널 단위 PATCH 1회**(저장 버튼), E1·E2·E8–E13은 즉시 반영 | | 저장 성공 후 **태그 자동 선택 잡** 트리거(§2.5) |

**트리 불변식(서버가 매 쓰기마다 보장)**
1. 루트(parent=null)는 depth=2(`d=0`)이고 label을 가진다.
2. depth ≤ 5.
3. 자식이 있는 노드는 `task_type=null`, 담당자 없음. 자식이 없는 노드는 리프이며 `task_type ∈ {공통, 지정}`.
4. 제출물이 존재하는 리프는 삭제·부모 전환·담당자 제거(해당자)·타입 변경으로 제출물을 고아로 만들 수 없다.
5. `start_date ≤ end_date`.
6. archived 노드의 하위는 모두 archived.

### 2.2 과제 제출 (§4.10, 라우트 `/rooms/[slug]/tasks/[id]`, 화면 없음)

| 항목 | 규칙 |
|---|---|
| 트리거 | 과제 상세 "제출/수정". 이 화면에선 "제출하러 가기"·보드 카드·캘린더 팝오버가 `goLeaf`로 커리큘럼 상세를 여는 것으로 대체 |
| 선행 조건 | 로그인 ∧ 방 **진행중** ∧ 내가 해당 리프의 **담당자**(공통: 활성 참가자, 지정: 명시) ∧ 리프가 보관 아님 ∧ `today ≥ s` |
| 입력 | `body` markdown(≤ 50k자), `links[]` URL(≤ 20개, http/https), `files[]` ≤ 5개, 각 ≤ 10MB, MIME 화이트리스트: `image/*`, `application/pdf`, `application/zip`(+`x-zip-compressed`), `text/*`(`.md` 포함) |
| 쓰기 | `PUT /tasks/{id}/submissions/me` (upsert). 최초 생성 시 `submitted_at = now`, `is_late = submitted_at > end_date 23:59:59 KST` **고정**. 이후 수정은 `updated_at`만 갱신, 횟수 무제한 |
| 파일 | 2단계: `POST /uploads` presigned(용량·타입 사전 검증) → 제출 본문에 `fileIds[]`. 서버는 제출 시 개수·합계 재검증 |
| 실패 | `TASK_NOT_ASSIGNED` 403 / `ROOM_NOT_ACTIVE` 409 / `TASK_NOT_STARTED` 409 / `TASK_ARCHIVED` 409 / `FILE_TOO_LARGE` 413 / `FILE_COUNT_EXCEEDED` 400 / `FILE_TYPE_NOT_ALLOWED` 415 / `INVALID_LINK` 400 |
| 열람 | 같은 방 **active 멤버**(그룹장 포함) 전원. 대기자·이탈자·비로그인·외부 403. 보관된 과제의 제출물은 그룹장 + 작성자만(§7) |
| 부수효과 | 제출로 리프가 `complete`(sub==asg)가 되면 **"과제 전원 제출" 알림**(그룹장, 방 설정의 `completion_mode`: daily 요약 / instant) |
| 삭제 | 제출 취소(삭제)는 §4.10에 없음 → **미지원** (내용을 비우는 수정만) |

### 2.3 설정 탭 (§4.11, 화면 없음) — 그룹장 전용

#### 2.3.1 방 정보 수정 `PATCH /rooms/{id}` — 상태별 필드 잠금
| 필드 | 모집중 | 진행중 | 종료 |
|---|---|---|---|
| title, intro, description, rules, cover, tags(수동) | 가능 | 가능 | 잠금 |
| start_date | 가능(≥ today) | **잠금** | 잠금 |
| end_date | 가능(≥ start) | 가능(≥ today ∧ ≥ 모든 노드 e) | 잠금 |
| max_members | 가능(≥ active 수) | 가능(≥ active 수) | 잠금 |
| min_members | 가능(≤ max) | **잠금** | 잠금 |
| is_public, join_mode | 가능 | **잠금** | 잠금 |
| leader_does_tasks | 가능 | **잠금**(공통 과제 집계가 바뀜) | 잠금 |
| 실패 | `FIELD_LOCKED` 409 (필드명 포함), `CAPACITY_BELOW_CURRENT` 400 | | |

#### 2.3.2 지금 시작 `POST /rooms/{id}/start` (§2.1)
모집중 → 진행중. 조건: 말단 과제 ≥ 1, 담당자 미정 지정 과제는 **경고 응답**(`warnings: [{taskId}]`)이되 차단하지 않음(자동 시작과 동일 동작). 부수효과: 대기 신청 전부 `expired`, "스터디 시작" 알림, `start_date = today`로 당김(§7).

#### 2.3.3 이탈 처리 `POST /rooms/{id}/members/{userId}/deactivate`
| 단계 | 규칙 |
|---|---|
| 미리보기 `GET …/deactivate-preview` | 대상의 **미제출 지정 과제**(보관 제외, 제출 없음) 목록 + 각 과제의 현재 담당자 수 → 다이얼로그 |
| 입력 | `decisions: [{taskId, action: "exclude"\|"reassign", assigneeIds?: []}]` — 미리보기 목록 **전부**에 대해 결정 필요(`LEAVE_DECISION_MISSING` 400) |
| 검증 | 대상이 active(`MEMBER_NOT_ACTIVE`), 대상 ≠ 그룹장(`CANNOT_LEAVE_LEADER`), 방 진행중(모집중은 "참가 취소/강퇴" 별도). `exclude` 결과 담당자 0명이 되면 `REASSIGN_REQUIRED` 400(§4.11 "담당자 0명이 되는 과제는 재지정 강제"). reassign 대상은 활성 참가자 |
| 상태 변화 | `room_member.status = left`, `left_at`. 지정 과제: 결정대로 담당 행 삭제/추가. 공통 과제: 담당 해제(= 활성 참가자가 아니므로 자동 제외). **이미 제출한 과제의 제출물은 보존**하되 집계에서 빠짐(목업 도윤 = `members`에 없음) |
| 알림 | 재지정된 사람에게 "지정 과제 배정", 이탈자에게 "스터디 이탈 처리" |

#### 2.3.4 알림 설정 `PUT /rooms/{id}/notification-settings`
| 키 | 기본 | 비고 |
|---|---|---|
| round_start, completion_summary, join_approved | 항상 ON(잠금) | 변경 요청 무시 또는 `FIELD_LOCKED` |
| deadline_reminder_1d, deadline_reminder_3d | ON/OFF | 스케줄러가 `e − 1d`, `e − 3d` 09:00 KST에 미제출 담당자에게 |
| assignment, schedule_change, start_end | ON | |
| completion_mode | `daily` \| `instant` | 과제 전원 제출 알림 |

#### 2.3.5 위험 영역
| 액션 | 조건 | 효과 |
|---|---|---|
| `DELETE /rooms/{id}` | 모집중만(`ROOM_STATUS_INVALID`) | 하드 삭제(노드·멤버·신청·태그 cascade). 진행중 이후는 불가 |
| `POST /rooms/{id}/archive` | 진행중·종료 | `status=archived`: 목록·사이드바에서 숨김, 읽기 전용, 제출물 보존. 복구 `unarchive`(§7) |

### 2.4 이 화면의 참가 관련 버튼
| UI | 연산 | 비고 |
|---|---|---|
| "신청 취소"(pending) | `DELETE /rooms/{id}/join-requests/me` | 공용(RoomView). 모집중만 |
| "내 과제 보기", "제출하러 가기", 탭·필터·펼침 | 클라 상태만 | 서버 호출 없음 |
| 공유 / 더보기 / 검색 / 필터 | 동작 없음 | 공유 = 초대 링크(비공개)·URL 복사 → `GET /rooms/{id}/invite-link`(그룹장) 후보 |

### 2.5 태그 자동 선택 (§2.6)
| 항목 | 규칙 |
|---|---|
| 트리거 | 커리큘럼 **저장 성공 후**(E14) 비동기 잡. 방 정보 수정 시도 동일 |
| 입력 | 방 제목·소개·설명 + 보관 제외 노드 제목·설명 |
| 출력 | 태그 사전(`tag_dictionary`)에서 0~5개 선택(사전 밖 자유 생성 금지) |
| 머지 | `room_tag.source='auto'` 행을 결과로 교체. `source='manual'` 유지. 그룹장이 **삭제한 자동 태그는 `suppressed` 목록**에 넣어 재선택돼도 복귀 금지 |
| 수동 편집 | `PUT /rooms/{id}/tags` `{labels[]}` — 사전 자동완성 + 자유 입력(자유 입력은 사전에 `custom`으로 추가) |
| 프론트 | 저장 응답은 즉시 반환, 토스트 "태그를 자동으로 다시 골랐어요"는 **잡 완료 후** 태그 재조회로 반영(§7: 동기 3초 타임아웃 대안) |

---

## 3. 파생 값 계산 규칙

### 3.1 사람별 코드 (리프 × 담당자) — 서버 계산 권장
```
assignees(leaf) =
  공통: room_member WHERE status=active (leader 포함 단 leader_does_tasks=true일 때)
  지정: task_assignee rows
code(leaf, user) =
  submission 존재 → is_late ? L : D
  else today <  leaf.s → P
  else today >  leaf.e → M
  else                 → O
```
목업 `codes` 문자열은 `PLANS.members` 순서. `buildTree`의 "자동 채우기"(공통 과제의 `-` → `P`/`O`)는 서버 규칙으로 흡수된다.
검증(aws, today 10-12): IAM 정책 이해 `DLDM` → 민수 D, 지은 L, 철수 D, 하나 M (e=10-03 < today ∧ 미제출). EC2 `-DO-` → 지은 D, 철수 O(10-08 ≤ 10-12 ≤ 10-14).

### 3.2 리프 집계
`asg = |assignees|`, `sub = |{D,L}|`, `state` = §0.3.

### 3.3 부모 진척률 / 전체 / 참가자
```
parent.asg = Σ child.asg  (archived 자식 제외, 재귀)
parent.sub = Σ child.sub
parent.pct = asg ? round(sub/asg*100) : 0
overall    = Σ root.sub / Σ root.asg (archived 루트 제외), asg 0 → null("시작 전")
member(done,total) = 보관 제외 리프 중 내가 담당자인 수(total), 그중 D/L 수(done)
```
목업 검증(`buildTree` 실행값):

| 방 | 루트별 sub/asg | overall | 비고 |
|---|---|---|---|
| aws | 1주차 5/8=63%, 2주차 1/3=33%, 3주차 0/4, 4주차 0/4, 5주차 0/6 | **6/25 = 24%** | 스펙 표의 "40%"는 하드코딩. 트리 집계로 통일 |
| spring | 9/10=90%, 3/10=30%, 0/10, 0/5 | 12/35 = 34% | |
| sqld | 0/2 ×4 | null → "시작 전" | 가은만 활성 → 공통 asg=1씩, 지정 1개는 0 |
| algo | 23/24=96%, 21/24=88%, 24/30=80% | 68/78 = 87% | 목업 문구 "제출 68 / 78건" 일치 |

참가자(aws): 민수 2/5, 지은 2/7, 철수 2/6, 하나 0/7, 도윤 "–"(이탈). 목업 `members[].done/total`(2/3, 2/4…)은 **버려진다**.
반올림: `Math.round` (62.5 → 63). 서버도 half‑up.

### 3.4 D-day / 기간 표기
`dday(today, target)`: 0 → "D-DAY", 양수 → "D-n", 음수 → "D+n". 방: active는 end, recruit는 start. 보드 카드 `hot` = overdue ∨ 0 ≤ left ≤ 2. 사이드바 `left` = 내 다음 마감까지 일수.

### 3.5 보드 컬럼 (`boardColumn`)
| 모드 | 예정 | 진행중 | 완료 |
|---|---|---|---|
| 내 칸반 (내 코드) | P | O, **M**(기한 지남, 빨간 강조 "기한 지남") | D, L |
| 팀 칸반 (state) | planned, unassigned | progress, **delayed**(빨간 강조) | complete(✓ 완료 배지) |
- 대상: 보관 제외 리프, 회차 필터(`roundId`), 내 칸반은 내가 담당자인 것만. 정렬 `e` 오름차순.
- 검증 aws 내 칸반(철수): IAM D·VPC D → 완료 / EC2 O → 진행중 / ALB·Auto·RDS P → 예정. S3·DynamoDB는 미담당이라 제외. 팀 칸반: IAM·VPC delayed(미제출자 있음 ∧ e 경과) → 진행중, EC2·S3 progress → 진행중, 나머지 planned → 예정.
- 내 담당 과제 0개(sqld 대기자) → 빈 상태 문구.

### 3.6 캘린더
- 초기 anchor: `minS ≤ today ≤ maxE`(보관 제외 리프)면 today, 아니면 `minS` (algo → 2026‑07, sqld → 10‑26).
- 월간 그리드: 1일의 요일만큼 앞당긴 일요일 시작, `ceil((lead+dim)/7)`행. 주간: anchor가 속한 일~토.
- 막대 = 리프 기간 ∩ 주. 주 경계에서 조각, 시작 조각만 좌측 radius, 끝 조각에 담당자 코드 아이콘(최대 3 + "+N"). 레인: `col` 오름차순, 같으면 긴 것 먼저, 겹치지 않는 첫 레인.
- 막대 색 = `LeafState`. **특정인 필터**일 땐 그 사람 코드 → `CODE_STATE`(D/L complete, M delayed, O progress, P planned)로 색, 아이콘도 그 사람만.
- 회차 시작 마커: `root.s == 날짜 ∧ label` 있는 루트.
- 서버는 날짜별 집계를 만들 필요 없음(리프 목록만).

### 3.7 간트
- 범위: 루트 min s의 **일요일** ~ 루트 max e의 **토요일** (aws 09‑27 ~ 11‑07, 42일; algo 06‑28 ~, 98일).
- 리프 막대: x = `diffDays(start, s)·dw + 2`, w = `(일수)·dw − 4`, 색 = `LeafState`, 텍스트 `sub/asg`(w ≥ 44px) 또는 "미정".
- 부모 막대: 트랙 위 `pct%` 채움. 오늘선 `diffDays(start, today)`.
- 펼침 상태는 커리큘럼 탭과 공유(클라).

### 3.8 개요 "이번 회차" / "전체 일정" / "내 다음 마감"
```
currentRound = root with s ≤ today ≤ e (여러 개면 s 최신) ; 없으면 다음 시작 루트(예정) ; ended면 null
round.state  = today < s ? "예정" : today ≤ e ? "진행중" : pct == 100 ? "완료" : "기간 종료"
cur.tasks    = currentRound 하위 보관 제외 리프 전체(깊이 무관) + people
task 요약    = 전원 P ? "{s} 시작" : "{sub}/{asg} 제출"
nextDue(me)  = 내 담당 리프 중 code == O 를 e 오름차순 → 첫 번째 (null 가능)
sidebar.left = diffDays(today, nextDue.e)
```

---

## 4. 엔티티·관계 후보

| 엔티티 | 주요 필드 | 비고 |
|---|---|---|
| `room` **공용** | id, slug, title, intro, description(md), rules(md), start_date, end_date, max_members, min_members?, is_public, join_mode(direct/approval), leader_id, leader_does_tasks(bool, default true), cover_url?, status(recruit/active/ended/archived), started_at, archived_at | 상태 전이는 스케줄러 + "지금 시작" |
| `room_member` **공용** | room_id, user_id, role(leader/member), status(pending/active/left/rejected/expired/cancelled), joined_at, left_at | capCur = active 수 |
| `curriculum_node` | id, room_id, parent_id?, depth(2..5), sort_order, label?, title, description(md), start_date, end_date, task_type?(common/designated, 리프만), archived(bool), created_at, updated_at | 인덱스 (room_id, parent_id, sort_order). 깊이·리프 불변식은 서비스 계층 |
| `task_assignee` | node_id, user_id, assigned_at | **지정 과제만** 저장. 공통은 런타임 파생(§7 대안: 둘 다 물리화) |
| `submission` | id, node_id, user_id, body(md), submitted_at(최초, 불변), is_late(불변), updated_at | UNIQUE(node_id, user_id) |
| `submission_link` | submission_id, url, sort_order | ≤ 20 |
| `submission_file` | submission_id, file_id(storage key), name, size, mime | ≤ 5, 각 ≤ 10MB |
| `tag_dictionary` | id, label(unique), tone, kind(curated/custom) | tone = 팔레트 6종 |
| `room_tag` | room_id, tag_id, source(auto/manual), created_at | |
| `room_tag_suppressed` | room_id, tag_id | 삭제한 자동 태그 복귀 방지 |
| `room_notification_setting` | room_id, deadline_1d, deadline_3d, assignment, schedule_change, start_end, completion_mode | 1:1 |
| `notification` **공용** | user_id, room_id, type, payload, read_at | §2.5 알림 |
| `user` **공용** | id, email, nickname, avatar? | 아바타 색은 닉네임 해시(프론트) |

파생 캐시(선택): `node_stats(node_id, asg, sub, computed_at)` — 트리가 작아(≤ 수십 노드) 요청 시 계산으로 충분. 캐시는 2차.

---

## 5. API 후보

| METHOD path | 요청 | 응답 | 권한 |
|---|---|---|---|
| `GET /me/studies` | — | `{groups:[{kind, items:[{roomId, title, intro, when:{kind:deadline\|start\|end, date}, left?}]}]}` | 로그인 |
| `GET /rooms/{id}` **공용** | — | `RoomDto` (§6) + `membership:{status, role}` + `counts:{active, pending}` | 공개 방: 누구나 / 비공개: 멤버·초대 |
| `GET /rooms/{id}/curriculum` | `?includeArchived` | `{today, me, members:[{userId,name,role,status}], nodes:[NodeDto]}` | 멤버(공개 방은 읽기 허용, people은 멤버만) |
| `GET /rooms/{id}/overview` | — | `{currentRound, rounds[], nextDue, overall}` — 선택. 3.8 규칙을 서버에 두면 RoomView·MySchedule과 공유 | 멤버 |
| `POST /rooms/{id}/curriculum/nodes` | `{parentId?, title?, taskType?, startDate?, endDate?}` | `NodeDto` | 그룹장 |
| `PATCH /rooms/{id}/curriculum/nodes/{nid}` | `{title?, description?, startDate?, endDate?, taskType?, assigneeIds?}` | `NodeDto` + `warnings[]` | 그룹장 |
| `POST …/nodes/{nid}/move` | `{parentId, index}` | 트리 전체 | 그룹장 |
| `DELETE …/nodes/{nid}` | — | 204 / 409 `NODE_HAS_SUBMISSIONS` | 그룹장 |
| `POST …/nodes/{nid}/archive` · `/unarchive` | — | `NodeDto` | 그룹장 |
| `GET /rooms/{id}/tags` · `PUT` | `{labels[]}` | `[{label, tone, auto}]` | GET 누구나 / PUT 그룹장 |
| `GET /tags/suggest?q=` | — | 사전 자동완성 | 로그인 |
| `GET /tasks/{nid}` | — | 과제 상세 + `mySubmission?` + `submissions[]`(멤버만) | 멤버 |
| `PUT /tasks/{nid}/submissions/me` | `{body, links[], fileIds[]}` | `SubmissionDto{submittedAt, isLate, updatedAt}` | 담당자 |
| `POST /uploads` | `{name, size, mime}` | `{fileId, uploadUrl}` | 로그인 |
| `PATCH /rooms/{id}` | 2.3.1 필드 | `RoomDto` / 409 `FIELD_LOCKED` | 그룹장 |
| `POST /rooms/{id}/start` | — | `RoomDto` + `warnings` | 그룹장, 모집중 |
| `GET /rooms/{id}/members` · `…/{uid}/deactivate-preview` · `POST …/{uid}/deactivate` | `{decisions[]}` | 멤버 목록 / 미제출 지정 과제 목록 / 204 | 그룹장 |
| `GET/PUT /rooms/{id}/notification-settings` | 2.3.4 | 동일 | 그룹장 |
| `POST /rooms/{id}/archive` · `DELETE /rooms/{id}` | — | 204 | 그룹장 |
| `DELETE /rooms/{id}/join-requests/me` **공용** | — | 204 | 대기자 |

응답은 `today`(서버 KST 날짜)를 항상 포함 → 프론트 `TODAY` 대체.

---

## 6. 목업 ↔ 실데이터 전환 포인트

### 6.1 현재 export (`src/data/my-study.ts`)
| export | 용도 | 전환 |
|---|---|---|
| `ROOMS: Record<RoomId, Room>` | 헤더·개요·참가 정보 | `GET /rooms/{id}` → `Room` 어댑터. `period/dday/ddayLong/minText/cur/rounds/moreRounds/next`는 **서버 원본 + 프론트 포맷**으로 분리 |
| `PLANS: Record<RoomId, Plan>` (`members[]`, `RawNode.codes`) | `buildTree` 입력 | `GET /rooms/{id}/curriculum` → `Plan` 어댑터: `nodes[]`(parentId)→중첩 트리, 리프 `people[]`→`codes` 문자열(멤버 순서). 또는 `buildTree`를 `NodeDto` 직접 입력으로 개조(권장: `people`을 바로 받도록) |
| `SIDEBAR_GROUPS` | 사이드바 | `GET /me/studies` |
| `RoomId`, `ROOM_IDS`, `isRoomId` | 라우트 가드 | `string` slug; 404는 서버 응답 |
| `TaskType = "공통"\|"지정"` | 배지·편집 | DTO `taskType: "common"\|"designated"` ↔ 한글 매핑 |

### 6.2 백엔드 DTO (프론트 타입과 1:1)
```ts
RoomDto { id, slug, title, intro, description, rules, startDate, endDate, status,
          joinMode, isPublic, leader:{userId, name}, leaderDoesTasks,
          maxMembers, minMembers?, tags:[{label, tone, auto}],
          members:[{userId, name, role, status, joinedAt}],   // active+pending+left
          membership:{status, role} }
NodeDto { id, parentId, roundId, depth, sortOrder, label, title, description,
          startDate, endDate, archived,
          task?: { type, people:[{userId, name, code:"D"|"L"|"M"|"O"|"P"}] } }
```
`crumb`, `roundLabel`, `asg/sub/state/pct`는 프론트 `buildTree`가 계산(현행 유지). 서버가 같은 값을 `stats`로 동봉하면 테스트 대조에 쓴다.

### 6.3 목업에서만 가능한 것 → 대체
| 목업 | 실제 |
|---|---|
| `TODAY = "2026-10-12"` (`routes.ts`) | 서버 응답 `today`(KST) 또는 클라 `Intl` KST 날짜. 자정 전후 불일치 방지 위해 **서버 값 우선** |
| `ME = 철수` | 인증 사용자. `people[].userId === me.id`로 비교(이름 비교 금지, 닉네임 중복 가능) |
| 이름 문자열 키(`members: string[]`, `people.name`) | `userId` 키. 아바타 색은 닉네임 기반 유지 가능 |
| 오버라이드 메모리 저장(`Overrides`) | 각 조작을 API 호출로 치환, 응답 트리로 교체. 낙관적 갱신은 `Overrides` 구조를 그대로 재활용 가능 |
| `members[].done/total`, `rounds[].sub/total`, `cur.tasks`, `next`, 사이드바 `left` 하드코딩 | 전부 §3.8 파생. `OverviewTab`은 이미 트리로 덮어씀; `cur`·`next`·`SIDEBAR_GROUPS`만 추가 파생 필요 |
| `rounds` 3개 + `moreRounds` 문구 | 루트 전체 또는 윈도우(§7) |
| "그룹장 편집 미리보기" 세그먼트 전원 노출 | `membership.role === "leader"`일 때만 |
| 노드 id `"0.1"` 경로 | UUID + `roundId`. `BoardTab`의 `id.split(".")[0]` 제거 |

---

## 7. 디자인 프롬프트에 있으나 화면에 없는 것 / 불명확한 것

| # | 항목 | 제안 기본값 |
|---|---|---|
| 1 | **공통 과제 담당자: 동적 파생 vs 물리화** | 동적(활성 참가자). 단 중도 참가자(진행중 합류 불가 → 모집중에만 참가하므로 발생 안 함)와 이탈자만 고려하면 충분. 이탈자의 기제출 제출물은 보존하되 집계 제외 |
| 2 | 설정 탭·과제 상세 화면 부재 | API·엔티티는 본 문서대로 선구현, 화면은 후속. "제출하러 가기"는 당분간 `goLeaf` |
| 3 | 저장 단위 (필드 즉시 반영 vs "저장" 버튼) | 패널(노드) 단위 PATCH 1회. 구조 변경(E1·E2·E8–E13)은 즉시 |
| 4 | 시작 전(`today < s`) 제출 허용 여부 | **불허**(`TASK_NOT_STARTED`). 허용하면 P 상태에 제출이 겹쳐 상태 표가 깨짐 |
| 5 | 방 종료 후 제출 | 불허(`ROOM_NOT_ACTIVE`). 지각 제출은 진행중 기간 안에서만 |
| 6 | 마감 변경 시 `is_late` 재계산 | 재계산 안 함(§2.3 "최초 제출 시점 기준 고정"). 마감 연장은 미제출자에게만 혜택 |
| 7 | 부모/방 기간 밖 노드 기간 | 허용 + `warnings`. 간트·캘린더는 리프 기간을 그대로 그림 |
| 8 | 노드 기간 필수 여부 (§2.2 "넣을 수 있음") | 회차·리프는 필수, 중간 노드는 선택 → 없으면 자식 min/max로 파생. 목업은 전부 채워져 있어 1차는 전부 필수도 무방 |
| 9 | 회차 label | 저장 문자열, 생성 시 `"{n}회차"` 기본, 편집 가능. 순서 변경 시 자동 재번호 안 함 |
| 10 | 빈 부모(자식 0개)의 처리 | 리프로 자동 전환하지 않고 `task_type=null` "빈 부모"로 유지, 집계 0/0. UI는 "+"로 자식 추가 유도 |
| 11 | 제출물 있는 담당자 제거 (E7) | 409 거부. 필요하면 과제 보관 후 처리 |
| 12 | 보관 노드 제출물 열람 | 그룹장 + 작성자 |
| 13 | 태그 자동 선택 동기/비동기 | 비동기 잡 + 완료 후 재조회(토스트는 잡 완료 이벤트). 1차는 동기 호출 3초 타임아웃 fallback도 가능 |
| 14 | `rules` 저장 형식 | 마크다운 1필드. 목업 `string[]`은 어댑터에서 `- ` 라인 분해 |
| 15 | 전체 일정 노출 범위 / `moreRounds` | 현재 회차 −1 ~ +1 (3개) + "이후 N개 회차" (N = 뒤 루트 수). recruit는 전부 |
| 16 | `nextDue`에서 기한 경과 미제출(M) 우선 여부 | O만 (다음 마감). M은 보드 "기한 지남"으로 노출 |
| 17 | "지금 시작"이 `start_date`를 당기는지 | 당김(`start_date = today`). 1주차 기간은 건드리지 않음 |
| 18 | 그룹장 `leader_does_tasks=false`일 때 참가자 행 | `noBar` → "–". 공통 과제 담당자에서 제외 |
| 19 | 사이드바 "모집중 · 신청한 방" | recruit ∧ (joined ∨ pending). 내가 만든 모집중 방도 여기에 |
| 20 | 비공개 방 커리큘럼의 `people` 노출 | 멤버만. 공개 방 비로그인은 노드·집계만, `people` 빈 배열 |
| 21 | 드래그 정렬/들여쓰기 UI | 미구현. `move` API만 준비 |
| 22 | 방 보관 해제 | `unarchive` 제공(그룹장), 원래 status로 복귀 |
| 23 | 종료된 방 편집 | 불허(`ROOM_NOT_EDITABLE`). 그룹장 보관만 |
