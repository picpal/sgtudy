# MySchedule.dc.html "내 일정 — 참가한 스터디 통합 캘린더" 구현 스펙

# 0. 공통 토큰
- 폰트: 'IBM Plex Sans KR' 400/500/600/700, Google Fonts에서 로드. 폴백은 system-ui, sans-serif
- 페이지 배경 #EEF4F2, 기본 텍스트 #1B2230
- 링크 기본색 #0D7A64, hover 시 #095C4B
- 회색 계열
  - 보조 텍스트: #4A5563, #5B6675
  - 흐린 텍스트: #7A8594
  - 다른 달 날짜: #A7B0BA
- 테두리 #E4ECEA. 셀 구분선 #EEF2F1. 스크롤바 thumb #C9D6D2
- 강조
  - 위험/긴급: #B4462B
  - 알림 배지: #D64545
  - 일요일: #C0453A
  - 토요일/프로필: #2F5BC2, 프로필 배경은 #DCE6FB
- 상태 아이콘 색
  - 기한내 제출(done): #1E9E6A
  - 지각 제출(late): #C98A00
  - 미제출(missed): #D64545
  - 진행중(open): 흰색 원 + 테두리 #4A5563 1.8px
  - 예정(planned): 흰색 원 + 점선 테두리 #8C97A4 1.6px, dasharray 2.2 1.8
- 포커스 링
  - 버튼(.sd-btn)과 날짜 셀(.sd-day): `outline: 2px solid #0D7A64; outline-offset: -2px`
  - 막대(.sd-bar): `outline: 2px solid #1B2230; outline-offset: 1px`

# 1. 레이아웃 (위에서 아래로)
`.sd-app`: 높이 100vh, flex column, padding 16px, border-box.

## 1-1. 헤더
- 박스: max-width 1408px, 가운데 정렬, margin-bottom 16px, 흰색 배경, radius 18px, padding 10px 16px, flex-wrap, gap 12px
- 왼쪽 로고 링크(→ Main)
  - 30×30 SVG: rx 9, fill #1B2230. 안쪽 곡선 2개는 stroke #5FD3B8, 굵기 2.6
  - 텍스트 "슥터디": 20px, 700, letter-spacing -0.02em. 링크 gap 10px, padding-right 8px
- nav(aria-label "주 메뉴"): gap 4px. 아이템 3개, 각각 16px 아이콘을 포함
  - 아이템 공통: padding 9px 14px, radius 12px, 14px, 500, 색 #4A5563
  - 순서와 링크: 방 둘러보기(→ Main), 내 스터디(→ RoomDetail), 내 일정(→ MySchedule)
  - 현재 페이지는 "내 일정": aria-current="page", 배경 #EEF4F2, 색 #1B2230, 600
- 가운데 spacer: flex 1 1 24px
- 알림 버튼 (aria-label "알림 3개")
  - 44×44 원, 테두리 1px #E4ECEA, 흰 배경, 벨 아이콘 18px
  - 배지 "3": 우상단(top 5, right 5), 최소 16×16, radius 8, #D64545, 흰 글씨 10px 700
  - 클릭 핸들러 없음
- 프로필 버튼 (aria-label "내 프로필: 철수")
  - 44×44 원, 테두리 없음, 배경 #DCE6FB, 글자 "철" #2F5BC2 15px 700
  - 클릭 핸들러 없음

## 1-2. 본문 `.sd-body`
- max-width 1408, flex, gap 16px, 나머지 높이를 모두 채움
- main: `flex: 999 1 720px`
  - 흰 배경, radius 20px, padding 24px 24px 18px, 내부 flex column
- aside: `flex: 1 1 320px; max-width: 380px`
  - flex column, gap 16px
  - 카드 2개(.sd-half)가 높이를 반씩 나누고, 각자 overflow auto

## 1-3. main 상단 툴바
flex-wrap, gap 12px, margin-bottom 16px. 순서는 다음과 같습니다.
1. h1 `{y}년 {m+1}월`: 26px, 700, letter-spacing -0.02em, min-width 150px
2. 원형 버튼 2개 ‹ ›
   - 40×40, 테두리 1px #E4ECEA, 흰 배경, chevron 16px stroke 2
   - 버튼 사이 gap 6px
3. "오늘" 알약 버튼
   - 높이 40, padding 0 14px, radius 20, 테두리 #E4ECEA
   - 13px, 600
4. spacer: flex 1 1 20px
5. 스터디 필터 칩 그룹 (role="group", aria-label "스터디 필터")
   - gap 6px, wrap. 칩 3개, 스타일은 §3 참고
6. 보기 탭 (role="tablist", aria-label "보기 방식")
   - 컨테이너: 배경 #EEF4F2, padding 3px, radius 12px
   - 탭: "월간", "목록"
   - 탭 공통: 높이 34, padding 0 14px, radius 9, 13px
   - 선택된 탭: 흰 배경, #1B2230, 600, shadow `0 1px 3px rgba(27,34,48,.12)`
   - 선택 안 된 탭: 투명 배경, #5B6675, 500

## 1-4. 월간 보기 (view='month'일 때만 표시)
- 박스: 테두리 1px #E4ECEA, radius 16px, overflow hidden, flex column, 남은 높이를 채움
- 요일 헤더 행
  - 7열 grid, 배경 #F7FAF9, 아래 테두리 1px #E4ECEA
  - 칸: padding 10px, 12px, 600
  - 글자색: 일요일 #C0453A, 토요일 #2F5BC2, 나머지 #4A5563
- 주(week) 영역 (.sd-thin)
  - `grid-template-rows: repeat(rows, minmax(96px, 1fr))`, overflow auto
  - 주 행: position relative, 아래 테두리 1px #EEF2F1, min-height 96px
  - 주 행은 레이어 2개로 구성
  - 레이어 A (absolute inset 0): 7열 날짜 셀 버튼
    - 셀: padding 6px 8px, 마지막 열 제외하고 오른쪽 테두리 1px #EEF2F1, 왼쪽 정렬
    - 셀 배경: 선택됨 #F0F9F6 + `inset 0 0 0 2px #5FC8B0`, 이번 달 #FFFFFF, 다른 달 #FAFBFB
    - hover 배경 #F6FAF9
    - 셀 상단은 한 줄: 왼쪽 날짜 숫자, 오른쪽 회차 시작 마커 (gap 3px)
    - 날짜 숫자: 26×26 원, 13px
    - 오늘인 숫자: 배경 #1B2230, 흰 글씨, 700
    - 오늘이 아닌 숫자는 500. 글자색 우선순위는 다음 순서
      1. 다른 달: #A7B0BA
      2. 일요일: #C0453A
      3. 토요일: #2F5BC2
      4. 지난 날: #7A8594
      5. 그 외: #1B2230
  - 레이어 B: 과제 막대
    - relative, 7열 grid, `grid-auto-rows: 24px`, row-gap 4px, padding 36px 0 10px
    - 레이어 자체는 pointer-events none, 막대만 auto. 따라서 막대가 없는 셀 영역을 클릭하면 날짜 셀이 선택됩니다

## 1-5. 목록 보기 (view='list'일 때만 표시)
- 박스: 테두리 1px #E4ECEA, radius 16px, padding 20px 6px 20px 0
- 안쪽 스크롤 영역: padding 0 10px 16px 20px, `scrollbar-gutter: stable`, smooth scroll
- 섹션(주 단위)끼리 gap 28px
- 섹션 제목 h2 (sticky)
  - top -1px, 흰 배경
  - 그림자: `box-shadow: 0 -4px 0 #FFF, 0 6px 8px -6px rgba(27,34,48,.10)`
  - padding 4px 0 12px, 13px, 600, #4A5563
  - 이번 주 섹션에는 "이번 주" 배지: 11px, 700, 흰 글씨, 배경 #1B2230, padding 2px 7px, radius 6
- 행 li (.sd-row)
  - flex-wrap, gap 16px, padding 16px 18px, 테두리 1px #E4ECEA, radius 14px
  - hover: 테두리 #C9D6D2 + shadow `0 4px 12px rgba(27,34,48,.06)`
  - 행 간격 gap 10px
  - 행 구성 (왼쪽부터)
    - 마감일: 폭 92px, 13px, 600. 예: "10.14(수)"
    - 스터디 칩: 11px, 700, padding 3px 8px, radius 7, 스터디 bg/fg 색
    - 제목 블록 (flex 1 1 200px)
      - 제목: 14px, 600
      - 부제 "{회차} · {시작–끝}": 12px, #5B6675, margin-top 2
    - 상태 배지: 12px, 600, padding 4px 10px, radius 8
      - open: 흰 글씨 + 배경 #B4462B, 문구 "진행중 · D-n"
      - 그 외: #3A4452 글씨 + 배경 #EEF2F1
- 행은 클릭할 수 없습니다 (링크 없음)
- 빈 상태: 가운데 정렬 문단 "이 달에는 표시할 과제가 없어요", 14px, #5B6675, margin 24px 0

## 1-6. 범례 (main 하단, 두 보기 공통)
- flex-wrap, gap 16px, margin-top 12px, 12px, #4A5563
- 항목 순서
  1. 상태 아이콘 5종 (13px): 기한내 제출, 지각 제출, 미제출, 진행중, 예정
  2. "2주" 배지(#1B2230 배경) + 회차 시작
  3. 26×12 점선 박스(1px dashed #7A8594) + 시작 전 과제
  4. 26×12 사선 줄무늬 박스(테두리 1px #C98A00, `repeating-linear-gradient(135deg, #FBEFD3 0 4px, #FFF 4px 7px)`) + 승인 대기 스터디
  5. 안내문 "· 막대 = 과제 기간(클릭하면 상세), 아이콘은 마감일에 표시" (#5B6675)

## 1-7. aside 카드 1: 선택한 날짜 상세
- 카드: 흰 배경, radius 20, padding 20, flex column, gap 14
- 제목 줄
  - h2 `{M}월 {D}일 ({요일})`: 18px, 700
  - 선택일이 오늘이면 "오늘" 배지: 12px, 700, 흰 글씨, #1B2230, padding 2px 8px, radius 7
- 그룹: 최대 3개, 순서 고정, 항목이 없는 그룹은 숨김
  - 순서: "회차 시작" → "이 날 마감" → "진행 중인 과제"
  - 그룹 라벨: 12px, 600, #5B6675. 그룹 안 gap 8
- 항목: `<a href="RoomDetail">`
  - flex, gap 10, padding 10px 12px, radius 12, 테두리 1px #EEF2F1, min-height 44
  - 항목 구성
    - 스터디 칩: 11px, 700, padding 3px 8px, radius 7. 이름에서 " · " 앞부분만 표시
    - 제목: 14px, 600, 말줄임
    - 부제: 12px, #5B6675
    - 오른쪽 배지: 11px, 700, padding 3px 8px, radius 7
      - 긴급(이 날 마감 & open): 흰 글씨 + #B4462B
      - 그 외: #3A4452 + #EEF2F1
- 빈 상태: 점선 박스(1px dashed #C9D6D2, radius 14, padding 20px 14px), "이 날은 예정된 일정이 없어요", 13px, #5B6675

## 1-8. aside 카드 2: 다가오는 마감
- 카드 gap 12
- 제목 h2: 16px, 700
  - 깃발 아이콘 17px, stroke #B4462B
  - 텍스트 "다가오는 마감" + 보조 텍스트 "7일 이내"(12px, 500, #5B6675)
- li: flex, gap 10, padding 10px 12px, radius 12, 배경 #F7FAF9
  - D-day 배지: 폭 48, 12px, 700, padding 5px 0, radius 8, 흰 글씨
    - 남은 일수 2일 이하: #B4462B
    - 그 외: #4A5563
  - 제목: 14px, 600, 말줄임
  - 부제 `{스터디} · {M.DD}({요일}) 23:59`: 12px, #5B6675
- 항목은 클릭할 수 없습니다 (링크 없음)
- 빈 상태: "7일 안에 마감되는 과제가 없어요", 13px, #5B6675

# 2. 상태 모델과 인터랙션
초기 상태: `{ y:2026, m:9 (0-base, 즉 10월), sel:'2026-10-12', view:'month', off:[] }`. TODAY는 '2026-10-12'로 고정입니다. 날짜 계산은 모두 UTC 기준입니다.

| 요소 | 클릭 시 동작 |
|---|---|
| 로고, 방 둘러보기 | Main으로 이동 |
| 내 스터디 | RoomDetail로 이동 |
| 내 일정 | 현재 페이지 |
| 알림, 프로필 | 동작 없음 (목업) |
| ‹ 이전 달 / › 다음 달 | 월을 ±1. 연도가 넘어가면 연도도 처리. **sel은 유지** |
| 오늘 | y=2026, m=9, sel=TODAY로 이동. view는 유지 |
| 스터디 필터 칩 | 해당 스터디를 off 목록에 넣거나 빼는 토글 (aria-pressed). 전부 꺼도 됨 |
| 월간/목록 탭 | view 전환 (role=tab, aria-selected) |
| 날짜 셀 | sel을 그 날로 변경 (aria-pressed). 다른 달 날짜도 선택 가능하며, 이때 월은 바뀌지 않음 |
| 과제 막대 | 일반 스터디는 RoomDetail로, 승인 대기 스터디(sqld)는 RoomView로 이동. hover 시 shadow `0 3px 8px rgba(27,34,48,.18)`, translateY(-1px), z-index 2 |
| aside 날짜 상세 항목 | RoomDetail로 이동. 승인 대기 스터디 항목도 RoomDetail로 감 (원본 그대로, 막대와 다름) |
| 목록 행, 다가오는 마감 항목 | 동작 없음 |

스터디 필터가 영향을 주는 범위는 막대, 회차 시작 마커, 셀의 aria 카운트, 날짜 상세, 다가오는 마감, 목록 보기 전부입니다.

날짜 셀 aria-label 형식: `"10월 14일 수요일, 마감 1개, 회차 시작 1개"`. 마감·회차 시작 부분은 개수가 0이면 생략합니다.

# 3. 변형과 상태 표현

## 스터디 팔레트
| id | 이름 | bg | fg | dot | 비고 |
|---|---|---|---|---|---|
| aws | AWS SAA | #DDF4EE | #0B6553 | #12A386 | |
| spring | Spring 로드맵 | #EEE7FB | #5B3AA0 | #7C5BD0 | |
| sqld | SQLD · 승인 대기 | #FBEFD3 | #7A4F00 | #C98A00 | pending=true |

## 필터 칩
- 공통: 높이 34, padding 0 12px, radius 17, 13px, 칩 안 gap 6
- 앞에 점 9×9 원
- 켜짐: 테두리 1px dot색, 배경 bg, 글자 fg, 600, 점은 dot색
- 꺼짐: 테두리 #D9E2DF, 흰 배경, 글자 #7A8594, 500, 점은 #C9D1D6
- 칩 라벨은 전체 이름입니다 (예: "SQLD · 승인 대기")

## 과제 막대 (.sd-bar)
**배치**
- 주 단위로 잘라서 그립니다. 열 = `grid-column: col+1 / span n`
- 레인 배정: 시작 열 오름차순, 같으면 길이가 긴 것부터 정렬한 뒤, 이전 막대 끝이 현재 시작 열보다 작은 첫 레인에 그리디로 넣습니다. 행 = `grid-row: lane+1`
- 막대 높이 24px, 레인 간격 4px

**모양**
- radius: 실제 시작 쪽 끝만 왼쪽 7px, 실제 끝 쪽 끝만 오른쪽 7px. 주 경계에서 잘린 쪽은 0
- 바깥 margin: 시작 쪽 왼쪽 5px, 끝 쪽 오른쪽 5px
- padding 0 6px 0 8px, gap 4, 글자 12px, 색은 스터디 fg
- 굵기: open이면 700, 그 외 500

**배경과 테두리** (위에서부터 우선)
1. pending 스터디: 배경 `repeating-linear-gradient(135deg, bg 0 6px, #FFF 6px 10px)`, 테두리 1px solid dot
2. planned: 흰 배경, 테두리 1px dashed dot
3. open: bg 배경, 테두리 1.5px solid dot
4. done/late: bg 배경, 테두리 1px transparent, **opacity 0.72**

**라벨**
- 실제 시작 구간이거나 주의 첫 열(col 0)이면 제목만 표시
- 그 밖에는 "제목 (계속)". 말줄임 처리

**아이콘과 툴팁**
- 실제 끝 구간에만 상태 아이콘(14px) 표시
- title(툴팁): `{스터디전체명} · {회차} · {제목} ({M.DD}–{M.DD}) · {상태텍스트}`

## 상태 텍스트
| 상태 | 텍스트 |
|---|---|
| done | 기한내 제출 |
| late | 지각 제출 |
| missed | 미제출 (데이터에는 없음) |
| open | 진행중 |
| planned | 예정 |

## 회차 시작 마커 (셀 우상단)
- "1주차"를 "1주"로 줄여 표시
- 10px, 700, padding 1px 5px, radius 5, 배경 = 스터디 dot색, 흰 글씨
- title: `{스터디전체명} {N주차} 시작`

## 날짜 상세 패널 규칙 (sel 기준)
- **회차 시작**: 그 날의 마커
  - 제목 `{N주차} 회차 시작`
  - 부제: pending 스터디면 "승인되면 참여할 수 있어요", 아니면 "새 과제가 열렸어요"
  - 배지 "시작"
- **이 날 마감**: e == sel인 과제
  - 부제 `{회차} · {M.DD}–{M.DD} · {상태}`
  - 배지: done/late면 상태 텍스트, 그 외는 `마감 D-n` (D-DAY, D+n 포함)
- **진행 중인 과제**: s <= sel < e인 과제
  - 부제 `{회차} · {M.DD} 마감`
  - 배지 = 상태 텍스트

## 다가오는 마감
- 대상: open 또는 planned이면서 마감일이 TODAY ~ TODAY+7일 범위인 과제 (양끝 포함)
- 마감일 오름차순

## 목록 보기
- 대상: 마감일이 현재 표시 중인 달 안에 있는 과제
- 마감일의 주(일요일 시작) 기준으로 그룹을 만들고, 라벨은 `M.DD – M.DD`
- TODAY가 들어 있는 주에 "이번 주" 배지

## D-day 표기
| 남은 일수 | 표기 |
|---|---|
| 0 | D-DAY |
| 양수 n | D-n |
| 지난 n일 | D+n |

## 날짜 포맷
- `md`: "10.04" 형식. 월은 앞에 0을 붙이지 않고, 일은 두 자리
- 요일은 한 글자: 일 월 화 수 목 금 토

# 4. 목 데이터 요약

## 과제 15건 (스터디, 제목, 시작~끝, 상태, 회차)
**aws**
- IAM 정책 이해, 10/01–10/03, done, 1주차
- VPC 실습, 10/04–10/07, done, 1주차
- EC2 인스턴스 유형 정리, 10/08–10/14, open, 2주차
- ALB vs NLB 실습, 10/15–10/21, planned, 3주차
- Auto Scaling 정책 정리, 10/22–10/28, planned, 4주차
- RDS·Aurora 비교, 10/29–11/04, planned, 5주차

**spring**
- 섹션 1~5 정리 노트, 10/05–10/11, done, 1주차
- 스프링 컨테이너 실습, 10/08–10/11, late, 1주차
- 섹션 6~7 정리 노트, 10/12–10/18, open, 2주차
- 싱글톤 컨테이너 실습 코드, 10/15–10/18, planned, 2주차
- MVC 구조 이해 노트, 10/19–10/25, planned, 3주차
- 서블릿→MVC 리팩토링, 10/22–10/25, planned, 3주차
- MVC 1편 섹션 5~7 노트, 10/26–11/01, planned, 4주차

**sqld**
- 데이터 모델링 요약 노트, 10/26–11/01, planned, 1주차
- 1과목 기출 풀이, 10/29–11/01, planned, 1주차

## 회차 시작 마커 10건
| 날짜 | 스터디 | 회차 |
|---|---|---|
| 10/01 | aws | 1주차 |
| 10/05 | spring | 1주차 |
| 10/08 | aws | 2주차 |
| 10/12 | spring | 2주차 |
| 10/15 | aws | 3주차 |
| 10/19 | spring | 3주차 |
| 10/22 | aws | 4주차 |
| 10/26 | spring | 4주차 |
| 10/26 | sqld | 1주차 |
| 10/29 | aws | 5주차 |

## 기본 화면 결과 (2026년 10월, sel 10/12 월요일)
- 그리드: 10/1이 목요일이라 앞쪽 빈칸 4개 → 5주(9/27~10/31)
- 날짜 상세
  - 회차 시작: Spring 2주차 시작
  - 이 날 마감: 없음
  - 진행 중인 과제: EC2 인스턴스 유형 정리, 섹션 6~7 정리 노트
- 다가오는 마감
  - EC2 인스턴스 유형 정리: D-2 (빨강)
  - 섹션 6~7 정리 노트: D-6
  - 싱글톤 컨테이너 실습 코드: D-6

# 5. 다른 화면으로의 연결
| 출발 요소 | 목적지 |
|---|---|
| 로고, 방 둘러보기 | Main.dc.html |
| 내 스터디, 일반 스터디 막대, aside 날짜 상세 항목 전부 | RoomDetail.dc.html |
| 승인 대기(sqld) 스터디 막대 | RoomView.dc.html |
| 내 일정 | MySchedule.dc.html (자기 자신) |

# 6. 반응형
- 기준 프리뷰 크기: 1440×900
- 데스크톱: 앱 전체 높이 100vh에 고정. 캘린더, 목록, aside 카드는 각자 내부 스크롤
- `@media (max-width: 900px)`
  - `.sd-app`: 높이 auto, min-height 100vh
  - `.sd-body`: flex-wrap → aside가 아래로 내려감
  - aside: max-width 제한 해제
  - aside 카드(.sd-half): flex none, overflow visible
- 그 밖에 헤더, 툴바, 목록 행은 flex-wrap으로 자연스럽게 줄바꿈
- 스크롤바
  - 폭/높이 8px, thumb #C9D6D2, radius 8, 테두리 2px 흰색
  - 트랙 상하 margin 14px. 단 .sd-scroll은 0
  - `overscroll-behavior: contain`
  - Firefox: `scrollbar-width: thin`

# 7. 구현 시 주의 (원본의 특이점)
- TODAY와 "오늘" 버튼의 이동 대상이 2026-10-12로 하드코딩되어 있습니다. 목업 데이터가 2026년 10월 기준이므로 구현에서도 TODAY를 상수(2026-10-12)로 두되, 한 곳(`lib/today.ts`)에서만 정의한다.
- 막대는 날짜 셀 위에 겹쳐 그려집니다. 막대 레이어 padding-top 36px가 날짜 숫자 영역을 비워 둡니다. 레인이 많으면 행 높이가 늘어납니다 (min 96px).
- 'missed' 상태는 아이콘과 텍스트만 정의되어 있고 데이터에는 없습니다.
- 막대와 날짜 상세 항목은 `<a>`라서 키보드 포커스가 가능합니다. 목록 행과 다가오는 마감 항목은 정적 요소입니다.
