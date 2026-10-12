# Main.dc.html "방 목록 (메인 카드 그리드)" 구현 스펙

## 0. 전역 토큰
- 폰트: 'IBM Plex Sans KR' (Google Fonts, wght 400/500/600/700), fallback system-ui, sans-serif
- 페이지 배경 #F3F7F6, 기본 글자색 #1B2230, min-height 100vh, body margin 0
- 링크 기본색 #0D7A64, hover #095C4B (카드/네비 링크는 inline color로 덮어씀)
- focus-visible(.sd-card/.sd-btn/.sd-tab): outline 2px solid #0D7A64, offset 2px
- 보더 #E4ECEA, 보조 텍스트 #5B6675 / #4A5563 / #3A4452, placeholder #7A8594
- 주 CTA 색 #22264B(남색), 포인트 민트 #0D7A64, 경고/마감 #B4462B, 알림 배지 #D64545
- 프리뷰 크기 1440×1260
- .sd-clamp = 2줄 말줄임(-webkit-line-clamp:2)

## 1. 레이아웃 (위→아래)

### 1-1. Header
- 배경 #FFFFFF, border-bottom 1px #E4ECEA
- 내부 컨테이너: max-width 1376px, 가운데 정렬, padding 12px 32px, flex + wrap, align center, gap 16px
- 순서:
  1. 로고 링크(→ Main): 30×30 SVG(rx 9, 배경 #1B2230, 민트 #5FD3B8 곡선 2개, stroke 2.6) + "슥터디" 20px/700, letter-spacing -0.02em, gap 10px
  2. nav(aria-label "주 메뉴"), margin-left 12px, gap 4px. 각 항목 padding 8px 14px, radius 10px, 14px
     - "방 둘러보기" (현재 페이지, aria-current=page): 배경 #EEF4F2, #1B2230, 600 → Main
     - "내 스터디": #4A5563, 500 → RoomDetail
     - "내 일정": #4A5563, 500 → MySchedule
  3. spacer flex: 1 1 40px
  4. 검색 input(label 래핑): 높이 40, padding 0 14px, border 1px #E4ECEA, radius 12, 배경 #FAFCFB, flex 0 1 280px, min-width 160px. 왼쪽 돋보기 아이콘 16px(stroke #5B6675), gap 8. input type=search, placeholder "스터디 제목, 태그 검색", 14px, 테두리/아웃라인 없음, 투명 배경. sr-only 라벨 "스터디 검색"
  5. 알림 버튼: 44×44, radius 12, border 1px #E4ECEA, 흰 배경, 종 아이콘 18px(#1B2230, stroke 1.8). 우상단(top 6/right 6) 배지 "3": min-width 16, h16, radius 8, #D64545 배경, 흰 글자 10px/700. aria-label "알림 3개"
  6. 프로필 버튼: 44×44 원형, border 0, 배경 #DCE6FB, 글자 #2F5BC2, "철" 15px/700. aria-label "내 프로필: 철수"

### 1-2. main
- max-width 1376px, 가운데, padding 36px 32px 64px

(a) 타이틀 행: flex wrap, align flex-end, space-between, gap 16, margin-bottom 28
- 좌: h1 "스터디 방" 28px/700, ls -0.02em / p "함께 목표를 세우고, 누가 어디까지 왔는지 한눈에 확인하세요." 15px #5B6675, margin-top 6
- 우: "방 만들기" 버튼(링크 → RoomDetail): + 아이콘 16px(stroke 2.2), 높이 46, padding 0 20, radius 14, 배경 #22264B, 흰 글자 15px/600, gap 8

(b) 탭 + 상태칩 행: flex wrap, align center, space-between, gap 12, border-bottom 1px #E4ECEA, margin-bottom 24
- 좌: 탭(role=tablist, aria-label "방 범위"), gap 4
  - 탭 버튼: 높이 48, padding 0 14, 투명, 15px, margin-bottom -1px(하단 보더와 겹침), gap 6
    - 선택: border-bottom 2px #1B2230, 글자 #1B2230/700. 카운트 pill 배경 #1B2230 글자 #FFFFFF
    - 비선택: border-bottom 투명, #5B6675/500. 카운트 pill 배경 #E9EEF0 글자 #4A5563
    - 카운트 pill: 12px/600, padding 1px 7px, radius 10
  - 라벨/카운트(카운트는 필터와 무관한 고정 총계): 전체 공개 방 8 / 내가 참가한 방 4 / 내가 만든 방 1
- 우: 상태칩(role=group, aria-label "상태 필터"), gap 6, padding-bottom 10
  - 칩: 높이 34, padding 0 14, radius 17(pill), 13px
    - 선택: border 1px #1B2230, 배경 #1B2230, 흰 글자 600
    - 비선택: border 1px #D9E2DF, 흰 배경, #4A5563 500
  - 라벨: 전체 / 모집중 / 진행중 / 종료 (aria-pressed)

(c) 태그 필터 행(role=group, aria-label "태그 필터"): flex wrap, align center, gap 8, margin -8px 0 24px
- 앞 라벨: 태그 아이콘 15px + "태그" 13px/600 #3A4452, margin-right 4
- 태그 칩: "#라벨" + 카운트. 높이 32, padding 0 12, radius 16, 13px, gap 6
  - 선택: border #0D7A64, 배경 #DDF4EE, 글자 #0B6553/600, 카운트 #0B6553
  - 비선택: border #D9E2DF, 배경 #FFFFFF, 글자 #3A4452/500, 카운트 #7A8594
  - 카운트: 11px/600
- 태그 1개 이상 선택 시에만 "초기화" 버튼 표시: 되돌리기 아이콘 13px + "초기화", 높이 32, padding 0 10, 테두리/배경 없음, 13px/600 #0D7A64

(d) 빈 상태 박스 (결과 0건일 때만)
- 배경 #FFFFFF, border 1px dashed #C9D6D2, radius 20, padding 64px 24px, 세로 중앙정렬, gap 12
- 56×56 일러스트(카드 윤곽 #9FB3AD + 우상단 민트 원 #DDF4EE/#0D7A64 플러스)
- 제목 17px/600, 본문 14px #5B6675
- "방 만들기" 버튼 → RoomDetail: 높이 44, padding 0 18, radius 12, #22264B, 흰 14px/600, margin-top 8
- 주의: 빈 상태여도 아래 grid 컨테이너는 그대로 존재(빈 상태로)

(e) 카드 그리드
- display grid, grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)), gap 24
- 1440 뷰포트 기준 콘텐츠폭 1312 → 4열(카드 약 310px)

## 2. 카드 구조 (카드 전체가 <a> → RoomView)
- flex column, 배경 #FFFFFF, border 1px #E4ECEA, radius 18, overflow hidden, 텍스트 #1B2230, 밑줄 없음
- hover: transform translateY(-6px) + box-shadow 0 14px 28px rgba(27,34,48,.10), transition transform/box-shadow .18s ease
- 본문 영역: padding 18px 18px 16px, flex column, gap 10, flex 1 1 auto
  1. 배지 행(gap 6, wrap)
     - 상태 배지: 높이 24, padding 0 9, radius 8, 12px/600
       | 상태 | 라벨 | 배경 | 글자 |
       | recruit | 모집중 | #3B6FE0 | #FFFFFF |
       | active | 진행중 | #0D7A64 | #FFFFFF |
       | ended | 종료 | #E9EEF0 | #4A5563 |
       | full | 정원 마감 | #FDE8E1 | #B4462B |
     - 비공개 배지(pub=false일 때): 자물쇠 아이콘 12px + "비공개", 높이 24, padding 0 9, radius 8, 배경 #E9EEF0, #3A4452, 12px/600
  2. 제목 h2: 17px/700, line-height 1.4, ls -0.01em, min-height 48px, 2줄 clamp, word-break keep-all, overflow-wrap anywhere, title 속성에 전체 제목(툴팁)
  3. 소개 p: 14px, line-height 1.55, #5B6675, min-height 43px, 2줄 clamp
  4. 태그 행: 높이 24 고정, nowrap, overflow hidden(넘치면 잘림), gap 6
     - 태그: "#라벨" 12px, padding 3px 9px, radius 7, nowrap, flex 0 0 auto
     - 기본: 배경 #F1F4F6, 글자 #4A5563/500
     - 현재 태그필터에 선택된 태그면 하이라이트: 배경 #DDF4EE, 글자 #0B6553/600
  5. 상태 슬롯 박스: radius 12, padding 10px 12px, flex column, gap 7, 배경은 상태별 톤
     - 1행: 좌 슬롯라벨(톤 라벨색) / 우 값 — 12px/600, space-between
     - 2행: 진행바 트랙 높이 6, radius 3 / 채움 막대 width=퍼센트, radius 3
     - 3행: 시계 아이콘 13px(#5B6675) + 보조문구(12px #4A5563, 한 줄 ellipsis) + 강조값(700, #B4462B, 주로 D-day; 빈 문자열 가능). 행 높이 18
     - 상태별 톤 [슬롯배경, 라벨색, 막대색, 트랙색]:
       recruit: #EFF4FE, #2F5BC2, #3B6FE0, #D6E2FA
       full: #FDF1EC, #B4462B, #C9583A, #F4D9CF
       active: #EEF8F4, #0D7A64, #12A386, #CFE8E0
       ended: #F4F6F7, #4A5563, #7A8594, #DDE2E5
  6. 기간: margin-top auto(하단 밀착), 13px #5B6675
- 푸터: border-top 1px #EEF2F1, padding 12px 18px, flex space-between, gap 8, 13px
  - 좌: 리더 아바타(24px 원, 이니셜=리더 이름 첫 글자, 11px/700, 팔레트 색) + "by " + <b>리더명</b>(#1B2230/600), gap 8, 기본색 #5B6675
  - 우(gap 10):
    - 승인제(approval=true)면: 방패체크 아이콘 13px + "승인제" 12px #5B6675, title "그룹장 승인제"
    - 인원: 사람 아이콘 14px + "cur/max", 600. cur>=max면 #B4462B, 아니면 #1B2230
- 아바타 팔레트 [배경, 글자]: mint #D3F0E8/#0D7A64, blue #DCE6FB/#2F5BC2, peach #FBE3D9/#B4462B, lav #E9E2FA/#6B45B8, amber #FBEFD3/#8A5A00, slate #E3E7EC/#4A5563
- 참고: 소스에 커버 영역(높이 150, 큰 워드마크 40px) 스타일 계산 코드가 있지만 마크업에서 렌더하지 않음 → 구현 불필요(죽은 코드)

## 3. 인터랙션 전체 목록
| 요소 | 동작 |
|---|---|
| 로고, "방 둘러보기" | → Main(자기 자신) |
| "내 스터디" | → RoomDetail |
| "내 일정" | → MySchedule |
| "방 만들기"(상단, 빈 상태 둘 다) | → RoomDetail (전용 생성 화면 없음, 목업상 링크) |
| 검색 input | onInput마다 state.q 갱신 → 즉시 필터(디바운스 없음) |
| 알림 버튼 | 핸들러 없음(시각 요소만, 배지 3 고정) |
| 프로필 버튼 | 핸들러 없음 |
| 탭 3개 | state.tab = public/mine/created. 다른 필터(상태/검색/태그)는 유지됨 |
| 상태칩 4개 | state.status = all/recruit/active/ended (단일 선택) |
| 태그 칩 | state.tags 토글(다중 선택) |
| 초기화 | state.tags = [] |
| 카드 전체 | → RoomView (모든 카드 동일 목적지, 방 id 전달 없음 — 실구현 시 /rooms/:id 권장) |
로그인/비로그인 분기 없음(항상 '철수' 로그인 상태 가정). 상태별 클릭 차이 없음.

## 4. 상태 및 필터 로직
- 초기 state: { tab: 'public', status: 'all', q: '', tags: [] }
- 탭 소속: public → pub===true / mine → mine===true / created → created===true
- 상태 필터: 'full'(정원 마감) 방은 '모집중' 칩에 포함(statusOf: full→recruit). 배지는 여전히 '정원 마감'
- 검색: (title + ' ' + tags.join(' ')).toLowerCase()에 trim+lowercase한 q 포함 여부. 소개문은 검색 대상 아님
- 태그 필터: 선택 태그 중 하나라도 가진 방(OR)
- 적용 순서: 탭 → 상태 → 검색 → 태그
- 태그 칩 목록/카운트: 현재 탭의 방만 기준(상태/검색/태그 필터 무시)으로 집계. 정렬 = 카운트 내림차순, 동률 시 localeCompare(…,'ko')
- 탭 카운트: 전체 raw 기준 고정(8/4/1)
- 빈 상태 문구 우선순위:
  1. 검색어 있음: 제목 "‘{q}’ 검색 결과가 없어요" / 본문 "다른 키워드나 태그로 다시 찾아보세요."
  2. created 탭: "아직 만든 방이 없어요"
  3. mine 탭: "참가한 방이 없어요"
  4. 그 외: "조건에 맞는 방이 없어요"
  2~4 본문: "채팅방 만들듯 30초면 충분해요. 첫 스터디를 열어 보세요."
- 슬롯 라벨 종류(상태·참여 여부에 따라): 모집 현황(모집중/정원마감), 내 진척률(내가 참가한 진행중), 전체 진행(참가 안 한 진행중), 최종 달성률(종료)

## 5. Mock 데이터 (9개 방, 배열 순서 = 렌더 순서)
| id | 제목 | 상태 | 공개 | 승인제 | 인원 | 리더(팔레트) | 태그 | mine/created | 기간 | 슬롯 [라벨, 값, %, 보조, 강조] |
|---|---|---|---|---|---|---|---|---|---|---|
| aws | AWS SAA 자격증 3개월 완주 | active | O | O | 4/6 | 민수(mint) | AWS, 클라우드, 자격증 | mine | 2026.10.01 – 12.31 · 3개월 | 내 진척률, 50%, 50, EC2 인스턴스 유형 정리, D-2 |
| toeic | 토익 900 8주 챌린지 | recruit | O | X | 2/8 | 서연(blue) | 영어, 토익 | - | 2026.11.02 – 12.27 · 8주 | 모집 현황, 2/8명, 25, 11.02(월) 시작 · 6자리 남음, D-21 |
| spring | Spring 김영한 로드맵 완강 | active | X(비공개) | O | 5/5 | 지훈(lav) | Spring, 백엔드, Java | mine | 2026.10.05 – 2027.01.31 · 17주 | 내 진척률, 33%, 33, 섹션 6~7 정리 노트, D-6 |
| algo | 알고리즘 매일 1문제 | ended | O | X | 6/6 | 현우(slate) | 알고리즘, 코딩테스트 | mine | 2026.07.01 – 09.30 · 13주 | 최종 달성률, 87%, 87, 13주 완주 · 제출 68/78건, (없음) |
| jcg | 정보처리기사 실기 2주 완성 | full | O | O | 4/4 | 수민(peach) | 자격증, 정보처리기사 | - | 2026.10.19 – 11.01 · 2주 | 모집 현황, 4/4명, 100, 10.19(월) 시작 · 정원 마감, D-7 |
| cs | CS 면접 질문 주 2회 — 운영체제·네트워크·데이터베이스 단골 질문 완전 정복하고 모의 면접까지 | recruit | O | X | 3/6 | 예린(amber) | CS, 면접 | - | 2026.10.19 – 11.30 · 6주 | 모집 현황, 3/6명, 50, 10.19(월) 시작 · 3자리 남음, D-7 |
| react | 리액트 공식문서 함께 읽기 | active | O | X | 5/8 | 태호(blue) | React, 프론트엔드 | - | 2026.09.21 – 11.15 · 8주 | 전체 진행, 4/8주, 50, 4주차 · 컴포넌트 상태 관리, (없음) |
| docker | Docker·K8s 입문 6주 | recruit | O | X | 0/6 | 철수(blue) | Docker, Kubernetes, 클라우드 | created | 2026.11.09 – 12.20 · 6주 | 모집 현황, 0/6명, 0, 11.09(월) 시작 · 첫 참가자를 기다려요, D-28 |
| sqld | SQLD 4주 벼락치기 | recruit | O | O | 1/5 | 가은(amber) | SQL, 데이터, 자격증 | mine | 2026.10.26 – 11.22 · 4주 | 모집 현황, 1/5명, 20, 10.26(월) 시작 · 승인 대기중, D-14 |

소개문(intro):
- aws: IAM부터 고가용성 아키텍처까지, 매주 회차별 과제로 SAA-C03 합격까지 함께 달려요.
- toeic: 매일 LC·RC 한 세트씩 풀고 오답 노트를 공유해요. 주말엔 모의고사 1회.
- spring: 핵심 원리부터 JPA 활용까지 로드맵 순서대로, 섹션별 정리 노트를 제출합니다.
- algo: 백준·프로그래머스에서 하루 한 문제. 풀이와 회고를 짧게 남기는 13주 습관 만들기.
- jcg: 기출 회독 3회와 약점 단원 집중. 매일 저녁 9시 진도 체크.
- cs: 운영체제·네트워크·DB 단골 질문을 주 2회 나눠 답변을 작성하고 서로 리뷰해요.
- react: react.dev Learn 섹션을 주차별로 읽고, 챕터마다 작은 예제를 만들어 공유합니다.
- docker: 컨테이너 기초부터 쿠버네티스 배포까지, 매주 실습 결과를 스크린샷과 링크로 공유해요.
- sqld: 데이터 모델링부터 SQL 활용까지 4회차. 마지막 주는 모의고사로 마무리해요.

파생 결과:
- 초기 화면(전체 공개 방/전체): spring 제외 8장 — aws, toeic, algo, jcg, cs, react, docker, sqld
- 내가 참가한 방: aws, spring, algo, sqld (spring만 '비공개' 배지 노출)
- 내가 만든 방: docker 1장
- 공개 탭 태그 카운트: 자격증 3, 클라우드 2, 나머지 1

## 6. 다른 아트보드 연결
- RoomView: 모든 카드 클릭
- RoomDetail: nav "내 스터디", "방 만들기" 2곳
- MySchedule: nav "내 일정"
- Main: 로고, "방 둘러보기"

## 7. 반응형
- 미디어쿼리 없음. 순수 유동 레이아웃:
  - 헤더/타이틀행/탭행/태그행 모두 flex-wrap → 좁아지면 줄바꿈
  - 검색창 flex 0 1 280px, min-width 160px
  - 그리드 auto-fill minmax(280px,1fr) → 4열(1440) → 3/2/1열 자동
  - 컨테이너 max-width 1376, 좌우 padding 32 고정(모바일에서 16으로 줄이는 건 구현 시 판단)
- 카드 내부 높이 정렬 장치: 제목 min-height 48, 소개 min-height 43, 태그 행 높이 24 고정, 기간 margin-top auto

## 8. 접근성 속성(그대로 유지 권장)
- nav aria-label "주 메뉴", 현재 항목 aria-current="page"
- 탭 role=tablist/tab + aria-selected, 상태칩/태그칩 aria-pressed, 그룹 aria-label("상태 필터","태그 필터")
- 아이콘 SVG 전부 aria-hidden, 알림/프로필 aria-label
