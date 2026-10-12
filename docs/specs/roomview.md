# RoomView.dc.html "방 상세 — 둘러보기에서 카드 클릭" 구현 스펙

## 0. 먼저 알아둘 점
- 이 시안에는 **히어로/커버 이미지와 커리큘럼 트리(펼침/접힘)가 없습니다**. 커리큘럼은 "현재 회차 카드"와 "전체 일정" 리스트(펼침 없음, 3개만 보이고 나머지는 "이후 N개 회차가 더 있어요" 텍스트) 두 곳에서만 보여 줍니다.
- 로그인/비로그인 분기도 없습니다. 항상 로그인한 사용자 **철수**(아바타 "철", blue) 기준입니다.
- 화면은 2단 마스터-디테일입니다. 왼쪽은 전체 스터디 목록 사이드바, 오른쪽은 선택한 방의 상세입니다. 왼쪽 카드를 누르면 오른쪽만 바뀌고 페이지 이동은 없습니다.
- 프리뷰 크기 1440×900. 폰트는 `IBM Plex Sans KR`(400/500/600/700, Google Fonts)이고 fallback은 system-ui, sans-serif입니다.
- 초기 state: `{ sel:'toeic', st:'all', q:'', join:{ sqld:'pending' } }`

## 1. 레이아웃 (위에서 아래로)

### 전역
- body 배경 `#EEF4F2`, 기본 글자색 `#1B2230`
- 링크 `#0D7A64`, hover `#095C4B`
- focus-visible: `outline 2px #0D7A64, offset 2px`
- 앱 컨테이너 `.rd-app`: padding 16, 데스크톱에서 `height:100vh; flex column`
- 각 행의 max-width 1408, 가운데 정렬

### 헤더
- 흰 배경(#FFF), radius 18, padding 10/16, flex wrap, gap 12, 아래 여백 16
- **로고**: 30×30 rect rx9 `#1B2230` 안에 `#5FD3B8` 곡선 2개(stroke 2.6). 옆에 "슥터디" 20px/700, letter-spacing -0.02em
- **주 메뉴 nav** (gap 4)
  - 항목: padding 9/14, radius 12, 14px, 아이콘 16px, gap 7
  - 활성: bg `#EEF4F2`, 글자 `#1B2230`/600, `aria-current=page`
  - 비활성: 글자 `#4A5563`/500, 배경 없음
  - 순서와 활성 여부: "방 둘러보기"(활성) / "내 스터디" / "내 일정"
- 가운데 spacer(flex 1)
- **알림 버튼**: 44×44 원, border `1px #E4ECEA`, 종 아이콘 18. 배지는 top5/right5 위치, 16px 높이, radius 8, `#D64545` 바탕에 흰 글씨 10px/700, 숫자 "3". `aria-label="알림 3개"`
- **프로필 버튼**: 44×44 원, bg `#DCE6FB`, 글자 `#2F5BC2` 15px/700 "철"

### 본문 `.rd-body`
- flex, gap 16, 왼쪽 aside와 오른쪽 main 두 칸

#### 좌측 aside "전체 스터디 목록"
- 크기: `flex:1 1 300px; max-width:380px`
- 흰 배경, radius 20, padding 22/20/20, flex column, gap 14
- 위에서부터:
  1. "← 카드 목록으로" 링크: 13px/500, `#4A5563`, 화살표 아이콘 14, min-height 28
  2. h2 "전체 스터디": 18px/700. 옆에 "{total}개"(13px/500 `#5B6675`). total은 필터와 상관없이 항상 8
  3. 검색 input
     - 높이 42, radius 21, border `1px #E4ECEA`, padding 0/14
     - 돋보기 16(`#5B6675`), placeholder "제목, 태그 검색"(placeholder 색 `#7A8594`), 14px
     - sr-only 라벨 "스터디 검색"
  4. 상태 필터 칩 그룹 "전체 / 모집중 / 진행중 / 종료" (gap 6)
     - 높이 32, radius 16, padding 0/12, 13px
     - 선택: bg·border `#1B2230`, 흰 글씨, 600
     - 미선택: 흰 배경, border `#D9E2DF`, 글자 `#4A5563`, 500
     - `aria-pressed` 사용
  5. 스크롤 영역 `.rd-scroll`
     - `flex:1; overflow-y:auto; margin 0 -10px; padding 6px 10px; gap 14`
     - 스크롤바: 폭 8, thumb `#C9D6D2`, radius 8, 2px 흰 border, track 위아래 margin 16
     - 그룹 라벨(모집중/진행중/종료): 12px/500 `#5B6675`, margin-top 4. 그룹 안 gap 10
     - **목록 카드** (button, `aria-pressed`)
       - padding 14/16, radius 16, 폭 100%, 왼쪽 정렬
       - 기본: bg `#FFF`, border `1px #E4ECEA`, hover 시 border `#C9D6D2`
       - 선택: bg `#F5FBF9`, border `#3FB89C`, box-shadow `0 0 0 1px #3FB89C, 0 0 0 5px #E3F6F0`, hover 시 border `#3FB89C`
       - transition: border/bg/shadow .15s
       - 1행(gap 6, wrap): 아래 칩들이 차례로 들어감
         - 일정 칩: 26 높이, radius 13, border `#E4ECEA`, 12px, 캘린더 아이콘 12, 내용은 `when`(예: D-21)
         - 첫 태그 칩: 26 높이, radius 13, 해당 태그의 팔레트 bg/fg, 12px/600
         - "+{나머지 태그 수}" 칩: border `#E4ECEA`, 600, `#4A5563`
         - spacer
         - 상태 마크(조건부): 11px/700, padding 3/8, radius 7
       - 상태 마크 종류:
         - 참가함: `#0B6553` / `#DDF4EE`
         - 승인 대기: `#7A4F00` / `#FBEFD3`
         - 참가중: `#0B6553` / `#DDF4EE`
         - 내 방: `#2F5BC2` / `#E3ECFD`
       - 제목: 15px/600, line-height 1.45, 2줄 말줄임(line-clamp 2), margin-top 12, `word-break:keep-all`, title 속성에 전체 제목
       - 하단 행: 12px `#5B6675`, 양끝 정렬, margin-top 6
         - 왼쪽: 기간. 요일 "(월)" 같은 부분은 정규식 `/\(.\)/g`로 지움
         - 오른쪽: "{현재}/{정원}명", 600 `#3A4452`
     - 결과가 0건일 때: "조건에 맞는 스터디가 없어요"(13px `#5B6675`, 가운데 정렬)
  6. 하단 고정 "+ 방 만들기" 버튼
     - 높이 50, radius 25, bg `#22264B`, 흰 글씨 15px/600, + 아이콘 16, 링크

#### 우측 main
- 크기: `flex:999 1 640px; min-width:0`
- 흰 배경, radius 20, padding 28/28/36. 데스크톱에서 자체 스크롤(`overflow-y:auto`, 스크롤바 스타일은 좌측과 같음)
- 안쪽은 flex wrap, gap 28, `align-items:flex-start`로 왼쪽 section과 오른쪽 aside 두 칸

**A. section "스터디 정보"** (`flex:999 1 460px`)

1. 타이틀 행
   - 왼쪽:
     - h1 제목: 30px/700, letter-spacing -0.02em, line-height 1.3, keep-all
     - 아래 intro: 15px `#4A5563`, line-height 1.6, margin-top 8
   - 오른쪽: "공유"(업로드 화살표 아이콘), "더보기"(점 3개) 원형 버튼. 44×44, border `#E4ECEA`, gap 6
2. 정보 dl
   - margin-top 24, grid `150px | 1fr`, row-gap 14, col-gap 12, 14px
   - dt: `#5B6675`, 아이콘 17 + gap 9
   - dd: 500
   - 항목:
     - **기간**: 기간 텍스트 + D-day 칩. 칩은 12px/600, padding 2/8, radius 7. 모집중이면 `#2F5BC2` / `#E3ECFD`, 그 밖에는 `#0D7A64` / `#DDF4EE`
     - **상태**: 상태 배지. 26 높이, padding 0/10, radius 8, 흰 글씨 12px/600. 모집중 `#3B6FE0`, 진행중 `#0D7A64`, 종료 `#5B6675`
     - **참가 방식**: `joinMode`. 시안 데이터에 이 값이 없어서 빈 칸으로 렌더링됩니다. approval 값에 따라 "바로 참가"/"승인제"를 넣는 쪽을 권장
     - **공개 범위**: "공개" 고정
     - **그룹장**: 26px 원형 아바타(이니셜) + 이름, gap 8
     - **태그**: 칩 목록. 높이 28, radius 14, padding 0/11, 팔레트 bg/fg, 12px/600, gap 4. `auto=true`인 태그 앞에는 반짝이(✦) 아이콘 12를 붙임(자동 생성 태그 표시)
3. 탭 바 (role=tablist)
   - margin-top 26, 위아래 border `1px #EEF2F1`, padding 8/0, gap 4
   - 탭: "개요 / 커리큘럼 / 보드 / 캘린더 / 간트"
   - 탭 크기: 높이 38, padding 0/14, radius 10, 14px
   - 선택(개요만 해당): bg `#EEF4F2`, 600, `#1B2230`
   - 나머지: 투명 배경, `#4A5563`
4. 현재 회차 카드
   - margin-top 22, border `1px #E4ECEA`, radius 18, padding 18/20, gap 14
   - 알약(pill): 28 높이, radius 14, bg `#EEE7FB`, 글자 `#6B45B8` 12px/600, 시계 아이콘 13. 예: "시작 전", "2주차 · 진행중", "종료"
   - 제목: 17px/700
   - 메타: 13px `#5B6675`, margin-top 4
   - 과제 목록(tasks가 있을 때만 표시)
     - li: bg `#F7FAF9`, radius 12, padding 12/14, gap 14, wrap
     - 1열(`flex 1 1 200px`):
       - 유형 칩: 11px/700, padding 2/7, radius 6. 공통은 mint(`#DDF4EE`/`#0D7A64`), 지정은 lav(`#EEE7FB`/`#6B45B8`)
       - 과제 제목: 14px/600
       - 날짜: 12px `#5B6675`
     - 2열 아바타 스택
       - 최대 4개까지 보임. 30px 원, 겹침 -6px, 바깥 테두리 2px `#F7FAF9`
       - 우하단(-3, -3)에 15px 상태 아이콘
         - done(기한내 제출): `#1E9E6A` 원 + 흰 체크
         - open(진행중): 흰 원 + stroke `#6B7684`
         - planned(예정): 흰 원 + 점선 stroke `#8C97A4`
       - 툴팁: "{이름} · {상태라벨}"
       - 4명을 넘으면 "+N" 원 추가. 32px, `#E9EEF0`, 흰 border 2, 11px/700 `#4A5563`
     - 3열(폭 96)
       - 요약: 12px/600, 오른쪽 정렬. 전원 planned면 "MM.DD 시작", 아니면 "{제출}/{인원} 제출"
       - 진행 바: 높이 5, track `#E2EAE7`, fill `#12A386`, 폭 = 제출 비율
5. "스터디 소개" h3
   - 15px/700, 원형 i 아이콘 16, margin 30/0/10
   - 본문 p: 14px, line-height 1.75, `#3A4452`
6. "운영 규칙" h3
   - 원형 체크 아이콘, margin 26/0/10
   - ul: padding-left 20, 14px, line-height 1.75, `#3A4452`
7. "전체 일정" h3
   - 원형 리스트 아이콘, margin 26/0/12
   - ol(gap 8)
     - 행: padding 12/14, radius 12, gap 12, wrap
       - 기본: border `#EEF2F1`, bg `#FFF`
       - 현재 회차(current): border `#9ED9C8`, bg `#F2FBF8`
     - 구성:
       - 라벨: 13px/700, 폭 64
       - 가운데 블록(`flex 1 1 180px`): 제목 14px/600, 아래 "{기간} · {state}" 12px `#5B6675`
       - 오른쪽 블록(폭 140): 바(높이 6, track `#E2EAE7`) + 요약 12px/600(폭 58, 오른쪽 정렬)
     - 바 색: 80% 이상이면 `#1E9E6A`, 그 밖에는 `#12A386`
     - 시작 전 회차(제출 수 없음): state는 "예정", 요약은 "과제 N개", 바 0%
   - 아래 "이후 N개 회차가 더 있어요": 13px `#5B6675`, margin-top 10. `moreRounds`가 비어 있으면 숨김

**B. aside "참가 정보"** (`flex:1 1 300px; max-width:360px`, gap 14)

1. **참가 카드**
   - border `#E4ECEA`, radius 20, padding 20, shadow `0 10px 30px rgba(27,34,48,.06)`, gap 16
   - 상단 행: 상태 배지(위와 같은 스타일) + 우측 `ddayLong`(13px/600)
   - 참가 인원
     - "참가 인원"(13px `#5B6675`) + "{cur}"(20px/700) + " / {max}명"(14px/500 `#5B6675`)
     - 바: 높이 8, radius 4
       - track: 모집중 `#D6E2FA`, 그 밖에는 `#E2EAE7`
       - fill: 정원 찼으면 `#C9583A`, 모집중이면 `#3B6FE0`, 그 밖에는 `#12A386`
     - 최소인원 문구: 12px/500, 아이콘 13
       - 충족: 체크 아이콘, `#0D7A64`. "최소 N명 · 충족", 정원이 찼으면 " · 정원 마감"을 덧붙임
       - 미충족: 느낌표 원 아이콘, `#8A5A00`. "최소 N명 · K명 더 필요해요"
   - 참가자 섹션
     - 헤더 13px/600 "참가자". 우측 힌트(500 `#5B6675`)는 모집중이면 "참가 확정 순", 그 밖에는 "참가자 목록"
     - 목록 행: padding 7/8, radius 10, gap 10. 본인(me) 행은 bg `#F3F7FF`
       - 아바타 30
       - 이름: 14px. 본인은 700, 나머지 500
       - 그룹장: 왕관 아이콘 15(`#E7A913`, stroke `#B07F00`)
       - 본인: "나" 칩(11px/600 `#2F5BC2` / `#E3ECFD`, padding 1/6, radius 6)
       - 우측 텍스트(12px `#5B6675`): "그룹장" 또는 "참가자"
       - 승인 대기 행
         - 아바타: 회색(`#E9EEF0`/`#8C97A4`) + 1.5px 점선 border `#A7B0BA`
         - 이름: `#7A8594`
         - 칩: "승인 대기"(`#4A5563` / `#E9EEF0`)
         - 우측 텍스트 없음
     - 참가자 0명일 때 빈 상태 박스
       - 1px dashed `#C9D6D2`, radius 14, padding 18/14
       - 사람+ 아이콘 28(`#8C97A4`)
       - "아직 참가자가 없어요"(13px/600 `#3A4452`)
       - "첫 번째 참가자가 되어 보세요"(12px `#5B6675`)
   - CTA 영역: 아래 3절의 상태 중 하나만 표시
2. **"한눈에 보기" 카드**
   - border `#E4ECEA`, bg `#F7FAF9`, radius 20, padding 18/20, gap 10
   - 제목 14px/700
   - dl: grid `88px | 1fr`, row-gap 8, 13px
   - 항목: 회차 / 과제 / 제출 방식("마크다운 · 링크 · 파일" 고정)

## 2. 인터랙션 목록

| 요소 | 동작 |
|---|---|
| 로고 | → Main |
| 방 둘러보기(활성) | → Main |
| 내 스터디 | → RoomDetail |
| 내 일정 | → MySchedule |
| 알림 버튼 / 프로필 버튼 | 핸들러 없음 |
| "카드 목록으로" | → Main |
| 검색 input | onInput으로 `q` 갱신. 실시간 필터. `trim().toLowerCase()`한 값이 "제목 + 모든 태그 라벨" 문자열에 포함되면 남김 |
| 상태 필터 칩 | `st` = all/recruit/active/ended. 해당 그룹만 표시. 그룹 안 항목이 0개면 그 그룹(라벨 포함)을 숨김. 모든 그룹이 사라지면 "조건에 맞는 스터디가 없어요" |
| 목록 카드 | `sel` = 해당 id. 오른쪽 상세 전체 교체, 선택 스타일 적용. URL 변경 없음 |
| "방 만들기" | → Main(링크). 실제 구현에서는 방 생성 플로우로 연결하는 것을 권장 |
| 공유 / 더보기 | 핸들러 없음. 공유는 링크 복사, 더보기는 메뉴를 권장 |
| 탭 5개 | 정적. 개요만 selected이고 전환 핸들러 없음 |
| 참가하기 | `join[sel]='joined'` → 버튼이 "참가 완료/참가 취소" 상태로 바뀜. 참가자 목록 끝에 철수(나)가 추가되고 인원 +1 |
| 참가 신청 | `join[sel]='pending'` → "승인 대기중" 상태. 목록에 철수가 승인 대기 행으로 추가되고 인원은 그대로 |
| 참가 취소 / 신청 취소 | `join[sel]='none'` → 원래의 참가하기 또는 참가 신청 버튼으로 돌아감. 확인 모달 없음 |
| "참가중 · 내 스터디에서 보기" | → RoomDetail |
| "내가 만든 방 · 관리하기" | → RoomDetail |
| "초대 링크 복사" | 핸들러 없음 |
| 비활성 버튼 | `disabled`, 클릭 불가 |

- 좌측 목록의 상태 마크와 "{현재}/{정원}명"도 같은 `join` state를 따라 즉시 갱신됩니다. 참가하면 마크가 "참가함"이 되고 인원이 +1 됩니다.
- 모달은 하나도 없습니다.

## 3. CTA 상태 결정 로직

`actionOf(id)` 규칙:
- `base`가 'recruit'가 아니면 `base` 값을 그대로 씁니다.
- `base`가 'recruit'이면 사용자의 `join` 값을 봅니다.
  - joined → leave
  - pending → pending
  - 그 밖에는 approval이 true면 apply, false면 join

| act | UI | 하단 안내문(12px `#5B6675`, 가운데 정렬) |
|---|---|---|
| join | "참가하기" 버튼. 높이 50, radius 25, `#22264B`, 흰 글씨 16px/600 | 바로 참가돼요 · 시작 전까지 언제든 취소할 수 있어요 |
| apply | "참가 신청" 버튼(스타일은 join과 동일) | 그룹장이 승인하면 참가가 확정돼요 |
| leave | 상태 박스 "✓ 참가 완료"(높이 48, radius 24, `#DDF4EE`/`#0B6553` 15px/600) + "참가 취소" 보조 버튼(높이 44, radius 22, border `#D9E2DF`, 흰 배경, 14px/500) | 모집 기간에만 참가를 취소할 수 있어요 |
| pending | 상태 박스 "⏱ 승인 대기중"(`#FBEFD3`/`#7A4F00`) + "신청 취소" 보조 버튼 | 시작일까지 승인되지 않으면 신청이 자동 만료돼요 |
| joined | "참가중 · 내 스터디에서 보기" 링크 버튼(`#0D7A64`, 15px/600) | 과제 제출과 진척 확인은 내 스터디에서 해요 |
| owner | "내가 만든 방 · 관리하기"(`#22264B`) + "초대 링크 복사" 보조 버튼(링크 아이콘 15) | 없음 |
| full | 비활성 버튼 "정원 마감"(bg `#E9EEF0`, 글자 `#5B6675`, 15px/600, cursor not-allowed) | 자리가 생기면 다시 참가할 수 있어요 |
| activeClosed | 비활성 버튼 "모집 종료" | 이미 진행 중인 스터디는 참가할 수 없어요 |
| ended | 비활성 버튼 "모집 종료" | 종료된 스터디예요 · 기록은 계속 볼 수 있어요 |

좌측 목록 마크 대응: leave → 참가함, pending → 승인 대기, joined → 참가중, owner → 내 방. 나머지 상태는 마크 없음.

## 4. Mock 데이터 (8개 방)

| id | 제목 | status / base / 승인제 | 인원 (최소) | 그룹장 | 현재 회차·특이점 |
|---|---|---|---|---|---|
| toeic (초기 선택) | 토익 900 8주 챌린지 | 모집중 / recruit / 아님 | 2/8 (4) | 서연 | 시작 전. 참가하기 노출 |
| cs | CS 면접 질문 주 2회 — … 모의 면접까지 | 모집중 / recruit / 아님 | 3/6 (3) | 예린 | 아주 긴 제목. 말줄임 테스트용 |
| sqld | SQLD 4주 벼락치기 | 모집중 / recruit / **승인제** | 1/5 (3) | 가은 | 초기 join이 pending이라 승인 대기 상태로 시작 |
| docker | Docker·K8s 입문 6주 | 모집중 / **owner** / 아님 | 0/6 (2) | 철수(본인) | 참가자 0명 빈 상태 |
| jcg | 정보처리기사 실기 2주 완성 | 모집중 / **full** / 승인제 | 4/4 (3) | 수민 | 정원 마감. moreRounds 없음 |
| aws | AWS SAA 자격증 3개월 완주 | 진행중 / **joined** / 승인제 | 4/6 (3) | 민수 | 철수가 멤버(나). 2주차 진행중, 지정과제 2개 |
| react | 리액트 공식문서 함께 읽기 | 진행중 / **activeClosed** / 아님 | 5/8 (3) | 태호 | 4주차. 공통과제 2개(5명 → +1 overflow, 하나는 전원 planned) |
| algo | 알고리즘 매일 1문제 | 종료 / ended / 아님 | 6/6 (2) | 현우 | 철수가 멤버. 13주 완주 87%. 회차가 '완료' |

공통 필드:
- title, intro, status, base, approval
- period(예: `2026.11.02(월) – 12.27(일)`), when/dday, ddayLong(예: "시작까지 D-21", "종료까지 D-80", "09.30 종료")
- leader, tags[라벨, 톤, auto]
- capCur, capMax, minNeed, members[이름, {leader, me}]
- cur{pill, title, meta, tasks[]}
- about, rules[2개]
- rounds[라벨, 제목, 기간, 상태 또는 과제 수, sub, total, current]
- moreRounds, glance{rounds, tasks}

팔레트 PAL (bg / fg):
- mint `#DDF4EE` / `#0D7A64`
- blue `#E3ECFD` / `#2F5BC2`
- peach `#FDE8E1` / `#B4462B`
- lav `#EEE7FB` / `#6B45B8`
- amber `#FBEFD3` / `#7A4F00`
- slate `#E9EEF0` / `#4A5563`

이름별 아바타 색은 COLOR 맵에 고정되어 있고, 맵에 없는 이름은 slate를 씁니다. 아바타 글자 크기는 지름 × 0.42입니다.

좌측 그룹 순서:
- 모집중: toeic, cs, sqld, docker, jcg
- 진행중: aws, react
- 종료: algo

(구체적 텍스트 — intro/about/rules/rounds/tasks — 는 원본 RoomView.dc.html의 ROOMS 객체를 참고해 그대로 옮긴다.)

## 5. 다른 아트보드로 가는 링크
- **Main.dc.html**: 로고, "방 둘러보기", "카드 목록으로", "방 만들기"
- **RoomDetail.dc.html**: "내 스터디", joined CTA, owner CTA
- **MySchedule.dc.html**: "내 일정"
- 이름 붙은 라우트나 URL 파라미터는 없습니다. 방 선택은 컴포넌트 state(`sel`)로만 처리합니다. 실제 구현에서는 `/rooms/:id` 같은 형태를 권장합니다.

## 6. 반응형
- **데스크톱(>900px)**
  - 앱 높이 100vh 고정
  - 좌측 목록(`.rd-scroll`)과 우측 main이 각자 스크롤
- **≤900px**
  - 앱 `height:auto; min-height:100vh`
  - `.rd-body`가 wrap되어 사이드바가 위로 올라가고 폭은 전체(`max-width:none`)
  - 내부 스크롤을 해제하고(`overflow:visible`) 페이지 전체가 스크롤
- **그 밖의 줄바꿈은 모두 flex-wrap 기반**
  - main 안 section(기준 460) / aside(기준 300, 최대 360)는 폭이 모자라면 aside가 아래로 내려감
  - 헤더, 태그, 과제 li, 일정 행도 각각 wrap
- `word-break:keep-all` + `overflow-wrap:anywhere`로 긴 한글 제목을 처리합니다.
