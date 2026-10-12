# RoomDetail.dc.html "내 스터디 — 참가자 시점" 구현 스펙

브리프와 다른 점: 탭은 개요/커리큘럼/보드/캘린더/간트 5개이고 "참가자" 탭은 없습니다. 과제 제출 폼도 없습니다(제출 링크는 자기 자신을 가리킴). "이탈"은 상태 아이콘이 아니라 참가자 이름 옆 태그입니다.

# 0. 전역
- 폰트 'IBM Plex Sans KR'. 기본 글자색 #1B2230, body·앱 배경 #EEF4F2.
- 링크 색 #0D7A64, hover #095C4B. focus-visible: 2px solid #0D7A64, offset 2px.
- 미리보기 크기 1440×900. 기준일 TODAY = 2026-10-12(월), 나(ME) = '철수'.
- 색 팔레트 PAL [배경, 글자]: mint #DDF4EE/#0D7A64, blue #E3ECFD/#2F5BC2, peach #FDE8E1/#B4462B, lav #EEE7FB/#6B45B8, amber #FBEFD3/#7A4F00, slate #E9EEF0/#4A5563
- 사람별 아바타 색(COLOR): 민수·민재·보람 = mint / 지은·소율·지성 = peach / 철수 = blue / 하나·지훈·다은 = lav / 도윤·현우 = slate / 아린·가은·유진 = amber / 그 외 = slate
- 아바타 av(name,size,dim): 원형. 글자 = 이름 첫 글자, font-size = round(size×0.42), 700. dim이면 bg #E9EEF0, fg #8C97A4.
- 상태 배지: 높이 26, padding 0 10, radius 8, 흰 글자 12px/600. 배경은 모집중 #2F5BC2, 진행중 #0D7A64, 종료 #5B6675.
- 진행 막대 bar(pct,color): 기본 채움색 #12A386, radius 3. 트랙은 대부분 #E2EAE7, 진척률 카드만 #DCE8E4.
- 공통 컴포넌트
  - 세그먼트 컨트롤 segStyle: 컨테이너 padding 3, bg #EEF4F2, radius 12. 버튼 높이 34, padding 0 12, radius 9, 13px. 선택 = 흰 bg, #1B2230, 600, shadow 0 1px 3px rgba(27,34,48,.12). 미선택 = 투명 bg, #5B6675, 500.
  - 칩 chipStyle: 높이 34, padding 0 12, radius 17, 13px. 선택 = bg·border #1B2230, 흰 글자, 600. 미선택 = 흰 bg, border #D9E2DF, #4A5563, 500.
  - 과제 유형 배지 typeStyleOf: 11px/700, padding 2px 7px, radius 6. 공통 = mint, 지정 = lav.
- 원형 아이콘 버튼: 44×44, border 1px #E4ECEA, 흰 bg.

# 1. 레이아웃 (위→아래)
- .rd-app: height 100vh, padding 16, flex column.

## 1-1. 헤더
- 공용 AppHeader (card variant, active = 내 스터디).

## 1-2. 본문 .rd-body
- max-width 1408, flex, gap 16.

## 1-3. 좌측 aside "내 스터디 목록"
- flex 1 1 300px, max-width 380, 흰 bg, radius 20, padding 22 20 20, column gap 14.
- h2 "내 스터디" 18/700.
- 검색: label pill 높이 42, radius 21, border #E4ECEA, 돋보기 #5B6675, placeholder "검색" #7A8594. 동작 없음(목업).
- 필터 버튼 44 원형. 동작 없음.
- 스크롤 영역 .rd-scroll: 세로 스크롤, gap 14, 스크롤바 8px, thumb #C9D6D2.
- 그룹: 라벨 12px/500 #5B6675.
  - 진행중: aws "10.14 마감" D-2, spring "10.18 마감" D-6
  - 모집중 · 신청한 방: sqld "10.26 시작"
  - 종료: algo "09.30 종료"
- 카드(button.sd-item, aria-pressed)
  - padding 14 16, radius 16.
  - 미선택: border #E4ECEA, hover #C9D6D2.
  - 선택: bg #F5FBF9, border #3FB89C, shadow 0 0 0 1px #3FB89C, 0 0 0 5px #E3F6F0.
  - 1행 when 칩: 높이 26, radius 13, border, 12px, 달력 아이콘.
  - D-day 배지(우측 끝): 높이 26, radius 8, 13px/700, 흰 글자. bg는 남은 일수 ≤2면 #B4462B, 아니면 #22264B. title "다음 마감까지 N일".
  - 제목 15/600, 2줄 clamp, mt 12. 소개 13px #5B6675, 2줄 clamp, mt 6.
  - 클릭 → sel 변경 + 편집·필터 상태 리셋(4절 참고).
- 하단 "+ 새 스터디 찾기" 링크 → Main. 높이 50, radius 25, bg #22264B, 흰 글자 15/600.

## 1-4. 메인 main
- flex 999 1 640px, 흰 bg, radius 20, padding 28 28 36, 세로 스크롤.
- 안쪽 flex-wrap, gap 28:
  - section "스터디 정보": flex 999 1 460px
  - aside "참가 정보": 개요 탭에서만, flex 1 1 300px, max 360

### 공통 상단 (모든 탭)
- h1 제목 30/700, ls -0.02em, lh 1.3.
- 소개 p 15px #4A5563, lh 1.6, mt 8.
- 우측 버튼: 공유, 더보기(⋯). 둘 다 44 원형이고 동작 없음.

### 개요 탭 전용 메타 dl
- grid 150px | 1fr, row-gap 14, 14px. dt는 아이콘 17 + #5B6675.
- 기간: period + D-day 배지(12/600, #0D7A64 on #DDF4EE, radius 7).
- 상태: 상태 배지.
- 참가 방식.
- 공개 범위.
- 그룹장: 아바타 26 + 이름.
- 태그: 칩(높이 28, radius 14, PAL 톤, 12/600). auto=true면 반짝이 아이콘 12. 끝에 "✦ 자동 태그" 범례(12px #5B6675).

### 탭바
- role=tablist, mt 26, 상하 border 1px #EEF2F1, padding 8 0, gap 4.
- 탭 버튼: 높이 38, padding 0 14, radius 10, 14px. 선택 = bg #EEF4F2, #1B2230/600. 미선택 = #4A5563/500.
- 개요 | 커리큘럼 | 보드 | 캘린더 | 간트. 클릭하면 tab 변경 + calPick=null.

# 2. 탭별 상세

## 2-A. 개요 (기본 탭)

### 이번 회차 카드
- mt 22, border #E4ECEA, radius 18, padding 18 20, gap 14.
- 상단: pill(높이 28, radius 14, bg #EEE7FB, #6B45B8, 12/600, 시계 아이콘) 텍스트 cur.pill.
- 우측 "커리큘럼 전체 보기" 버튼(높이 36, radius 18, border, 13/500): tasks가 있을 때만. 클릭 → tab='curriculum'.
- 제목 17/700, 메타 13 #5B6675.
- 과제 li: bg #F7FAF9, radius 12, padding 12 14, gap 14, wrap.
  - 유형 배지 + 제목 14/600, 날짜 12 #5B6675.
  - 아바타 스택: 30px, 링 2px #F7FAF9, 겹침 -6. 최대 4명, 초과분은 "+N" 원 32(#E9EEF0, 11/700).
  - 상태 아이콘 15px, 우하단 -3/-3.
  - 우측 96px 영역: 요약 12/600 우정렬 + 5px 막대.
  - 요약: 전원 planned면 "{시작일} 시작", 아니면 "{제출수}/{인원} 제출".
  - 막대 채움: 전원 제출이면 #1E9E6A, 아니면 #12A386.
- 범례 5종(12px #4A5563, 아이콘 13): 기한내 제출 / 지각 제출 / 미제출(경과) / 진행중 / 예정.
- tasks가 없는 방(sqld·algo)은 pill + 제목 + 메타만 표시하고 리스트·범례·버튼 숨김.

### 본문 섹션 (h3 15/700, 아이콘 16 검정 원)
- 스터디 소개: 14px, lh 1.75, #3A4452.
- 운영 규칙: ul, padding-left 20.
- 전체 일정: ol, gap 8. 각 행:
  - padding 12 14, radius 12, gap 12, wrap.
  - 현재 회차: border #9ED9C8, bg #F2FBF8. 그 외: border #EEF2F1, 흰 bg.
  - 라벨 13/700 폭 64 | 제목 14/600 + "{dates} · {state}" 12px | 140px 영역(6px 막대 + 요약 12/600 폭 58).
  - 막대 색: pct ≥80 이면 #1E9E6A, 아니면 #12A386.
  - 요약: alt 텍스트가 있으면 그것(예: "과제 2개"), 아니면 sub/total.
- moreRounds 문구(13px #5B6675). 문구만 있고 클릭 동작 없음.

### 우측 aside "참가 정보"
카드 1: border, radius 20, padding 20, shadow 0 10px 30px rgba(27,34,48,.06), gap 16.
- 상태 배지 + ddayLong(13/600).
- 참가 인원
  - "참가 인원" 13px + 큰 숫자 20/700 "{cur}" + " / {max}명" 14/500 #5B6675.
  - 8px 막대: 정원 마감이면 #B4462B, 아니면 #12A386.
  - 최소인원 문구 12/500: 충족이면 체크 아이콘 + #0D7A64, 미충족이면 ! 아이콘 + #8A5A00.
- 전체 진척률 박스: bg #F7FAF9, radius 14, padding 12 14. 라벨 + "{n}%"(null이면 "시작 전") + 6px 막대.
- 참가자 목록: 헤더 "참가자 | 제출 / 담당". 각 행:
  - padding 7 8, radius 10, gap 10. 나인 행은 bg #F3F7FF.
  - 아바타 30.
  - 이름 14px: 나 = 700, 그 외 = 500. 이탈·대기 = #7A8594.
  - 그룹장이면 왕관 아이콘 15(fill #E7A913, stroke #B07F00).
  - "나" 배지(11/600, #2F5BC2 on #E3ECFD, radius 6).
  - 태그 배지 "이탈" 또는 "승인 대기"(11/600, #4A5563 on #E9EEF0).
  - 56×5 막대: 100%면 #1E9E6A, 0%면 #D64545, 그 외 #12A386.
  - 점수 "done/total" 12/600 폭 34. 이탈·대기·noBar면 "–"이고 막대 없음.
  - 이탈·승인 대기는 아바타 dim. 승인 대기는 추가로 1.5px dashed #A7B0BA 테두리.
- 액션 영역 (action 값별)
  - joined: "내 과제 보기" 버튼 → 보드 탭(내 칸반)으로 전환. 높이 48, radius 24, #22264B, 흰 15/600. 아래 문구 "진행 중에는 참가 취소를 할 수 없어요"(12px).
  - pending: "⏱ 승인 대기중" 박스(48, bg #FBEFD3, #7A4F00) + "신청 취소" 버튼(44, border #D9E2DF, 동작 없음) + "시작일까지 승인되지 않으면 신청이 자동 만료돼요".
  - closed: 비활성 버튼 "모집 종료"(bg #E9EEF0, #5B6675, not-allowed).

카드 2 "내 다음 마감" (next가 있을 때만)
- border #CBEBE1, bg #F2FBF8, radius 20, padding 18 20.
- 깃발 아이콘(#0D7A64) + 제목 14/700 + D-day 배지(흰 글자 on #B4462B, 12/700, radius 7).
- 과제명 15/600, path 12px, due 12px.
- "제출하러 가기 →" 버튼(#0D7A64, 14/600) → goLeaf(해당 리프) (커리큘럼 탭의 해당 과제 상세로).

## 2-B. 커리큘럼 탭

### 툴바
- "전체 진척률 **{overall}%** · 과제 {leafCount}개"(14px #4A5563).
- "모두 펼치기" → closed={}.
- "모두 접기" → 모든 부모 노드를 closed=true.
- 두 버튼: 높이 36, radius 18, border, 13px.
- 세그먼트 "참가자 보기"(view) / "그룹장 편집 미리보기"(edit). 전환하면 editSel·openLeaf·confirm·saved 리셋.
- edit 모드 안내 문구(12px): "그룹장에게만 보이는 편집 모드 미리보기예요. 항목을 누르면 오른쪽에서 수정할 수 있어요."
- 경고 배너: 지정 과제 중 담당자 0명이 있을 때. role=status, bg #FDF4E1, border #F0D79A, #6B4700, 13/500, ⚠ 아이콘. 문구 "담당자가 지정되지 않은 과제 {n}개 · 스터디 시작 전에 배정해 주세요". sqld에서 1개 발생.

### 트리 (role=tree)
- flex 999 1 440px, border, radius 16, overflow hidden.
- 행(treeitem, aria-level = depth+2)
  - min-height 52, padding 4 12 4 8, gap 8, border-bottom #EEF2F1.
  - bg: depth0 #FAFCFB, 그 외 흰색. edit 선택 행은 bg #F0F9F6 + inset 0 0 0 2px #3FB89C. 보관 항목은 opacity .55.
  - 들여쓰기 depth×22px.
  - edit 모드: 드래그 핸들(6점, #A7B0BA, cursor grab, title "드래그해서 순서 변경"). 시각 요소만 있고 실제 드래그 없음.
  - 부모 노드: 30×30 chevron 버튼(radius 8). 펼침 시 90° 회전, .15s. aria-expanded, aria-label "{title} 접기/펼치기".
  - 리프: chevron 자리에 6px 회색 점(#C9D6D2).
- 메인 버튼(행 대부분 영역)
  - 회차 라벨 배지: 흰 12/700 on #22264B, padding 3 8, radius 7. depth0만.
  - 리프는 유형 배지.
  - 제목: depth0 15/700, 중간 노드 14/600, 리프 14/500. ellipsis.
  - 날짜 "M.DD – M.DD" 12px #5B6675.
  - 보관이면 "보관됨" 배지(11/700, #4A5563 on #E9EEF0).
- 리프 우측
  - 아바타 스택 28px(링 #FFFFFF, 최대 4, +N 원 30).
  - 상태 아이콘 14px.
  - 담당자 0명이면 "담당자 미정" 배지(12/600, #7A4F00 on #FDF4E1).
  - "sub/asg" 12/600 폭 36.
- 부모 우측: 120px 영역(6px 막대 + "{pct}%" 12/700). 100%면 #1E9E6A.
- edit 모드, 부모 노드
  - depth ≤2: "+" 버튼(32, radius 9, border #D9E2DF, #0D7A64). title "{title}에 하위 과제 추가".
  - depth >2: 비활성 "+"(bg #F4F6F7, #A7B0BA). title "최대 5단계까지만 만들 수 있어요".

### 행 클릭 동작
- edit 모드: editSel=id. 우측 편집 패널 열림.
- view 모드, 리프: openLeaf 토글. 행 아래 상세 펼침.
  - padding 12 16 16 60, bg #F7FAF9.
  - "{crumb} · M.DD(요일) – M.DD(요일) · D-n(또는 '전원 제출')".
  - grid auto-fill minmax(150px,1fr) gap 8로 사람 카드:
    - padding 8 10, radius 10, border #E4ECEA. 나는 bg #EEF3FF + "(나)".
    - 아바타 30 + 이름 13/600 + 상태 라벨 12/600.
  - 담당자 0명이면 "아직 담당자가 없어요"(#7A4F00).
- view 모드, 부모: 펼침/접힘 토글.

### edit 모드 하단·우측
- 트리 하단 "+ 회차 추가" 버튼: 50 높이, bg #FAFCFB, #0D7A64 14/600.
  - "새 회차" 루트가 추가됨. 라벨 "{n}회차", 기간 = 마지막 회차 끝+1일부터 7일.
  - 추가된 회차가 바로 선택됨.
- 미선택 시 힌트 박스: flex 1 1 260 max 340, 1px dashed #C9D6D2, radius 16. 문구 "편집할 회차나 과제를 왼쪽에서 선택하세요. / 제목·기간·과제 유형·담당자를 바꿀 수 있어요."

편집 패널 aside "항목 편집"
- flex 1 1 280 max 340, border, radius 16, padding 18, gap 14, shadow 0 10px 30px rgba(27,34,48,.06).
- 경로: "{crumb} › {제목/라벨} · {depth+2}단계". 12px ellipsis.
- 닫기 X 버튼 → editSel·confirm·saved 리셋.
- 입력 필드(라벨 12/600 #4A5563; input 높이 42, border #D9E2DF, radius 10):
  - 제목 text. onInput으로 즉시 반영되어 트리에도 바로 보임.
  - 시작일·마감일 date 2열. 즉시 반영.
  - "설명 (마크다운)" textarea 3행. placeholder "목표, 참고 링크, 제출 형식 등을 적어 주세요". 바인딩 없음.
- 리프 전용
  - 과제 유형 세그먼트: "공통 · 참가자 전원" / "지정 · 일부 인원".
    - 공통 선택: 담당자 = 전원 자동.
    - 지정 선택: 현재 담당자로 assignOv 초기화.
  - 담당자 헤더 힌트: 공통이면 "활성 참가자 전원 자동 배정", 지정이면 "{n}명 선택됨".
  - 멤버 칩(높이 34, padding 0 12 0 6, radius 17, 아바타 22)
    - 선택: border #3FB89C, bg #E8F7F2, 600.
    - 공통일 때: aria-disabled, opacity .7, 클릭 무시.
    - 지정일 때: 클릭으로 토글.
  - 지정인데 0명이면 경고 "담당자 미정 · 시작 전에 한 명 이상 지정해 주세요"(#7A4F00 on #FDF4E1).
- 부모 전용 박스: "하위 항목 {n}개 · 진척률 {pct}%" + "하위 과제의 제출 수 ÷ 담당 건수로 자동 집계돼요".
- 저장 메시지 박스(role=status, #0B6553 on #DDF4EE).
- 하단 버튼
  - 좌측 삭제/보관 버튼(42, border #EBC3BD, #B4462B 13/600). 라벨 규칙:
    - 제출물(sub>0)이 없음 → "삭제"
    - 제출물 있음, 보관 안 됨 → "보관"
    - 제출물 있음, 보관됨 → "보관 해제"
  - 우측 "저장" 버튼(42, #22264B, 흰 14/600) → 메시지 "저장했어요 · 태그를 자동으로 다시 골랐어요".
- 삭제/보관 확인(인라인 alertdialog): border #F0C9C4, bg #FFF7F6, radius 12.
  - 제출물 없을 때 문구: "이 항목과 하위 항목을 삭제할까요? 되돌릴 수 없어요."
  - 제출물 있을 때 문구: "제출물이 있어 삭제할 수 없어요. 대신 보관하면 참가자 화면에서 숨겨지고 제출물은 그대로 남아요. 보관할까요?"
  - 버튼 [취소](흰 bg) / [삭제|보관](bg #B4462B, 흰 글자). 높이 38, radius 19.
  - 삭제 확정: 노드 제거 + 패널 닫힘.
  - 보관 확정: archived + 메시지 "보관했어요 · 제출물은 그대로 남아요".
  - 보관 해제(확인 없이 즉시): 메시지 "보관을 해제했어요".
- "+" 하위 추가: "새 과제" 공통 리프가 부모 기간으로 추가됨. 부모가 펼쳐지고 새 리프가 선택됨.
- 보관된 노드는 부모 진척 집계에서 빠짐. 보관 리프는 보드·캘린더 leaves 목록에서도 빠짐.

## 2-C. 보드 탭 (칸반)

툴바
- 세그먼트 "내 칸반"(기본) / "팀 칸반".
- 우측 회차 필터 칩: "전체 회차" + 루트별 라벨(1주차…).
- 힌트 12px
  - mine: "내가 담당한 과제만 보여요. 제출 상태에 따라 칸이 자동으로 바뀌어요 · 카드를 누르면 커리큘럼에서 상세를 볼 수 있어요."
  - team: "모든 과제의 팀 진행 상황이에요. 담당자 전원이 제출하면 '전원 제출'로 이동해요."
- mine 모드에서 내 과제가 0개면(sqld) 점선 박스: "아직 내게 배정된 과제가 없어요. 참가가 확정되면 여기에 보여요."

컬럼
- grid auto-fit minmax(240px,1fr), gap 14.
- 컬럼: bg #F4F7F6, radius 16, padding 12, min-height 180.
- 헤더 14/700: 점 9px + 라벨 + 개수 배지(12/600, #4A5563 on #E3E9E7).
- 컬럼 종류와 점 색: 예정 #8C97A4 / 진행중 #12A386 / mine "제출 완료" · team "전원 제출" #1E9E6A
- 컬럼 배정 규칙
  - mine(내 코드 기준): P → 예정, D·L → 완료, O·M → 진행중.
  - team(state 기준): planned·unassigned → 예정, complete → 완료, 그 외 → 진행중.
- 정렬: 마감일 오름차순.
- 빈 컬럼: "해당하는 과제가 없어요"(12px #7A8594).

카드(button)
- padding 14, radius 14, gap 6. hover 시 shadow 0 6px 16px rgba(27,34,48,.08), border #C9D6D2.
- overdue면 border #E7A9A3, bg #FFF6F5. overdue 기준: mine = 내 코드 M, team = state delayed.
- 1행
  - 유형 배지.
  - team & complete면 "✓ 완료" 배지(흰 on #1E9E6A).
  - 우측 D-day(미완료일 때만): 11/700, radius 7.
    - hot(overdue 또는 남은 0~2일) = 흰 글자 on #B4462B, 그 외 = #3A4452 on #E9EEF0.
    - overdue면 텍스트 "기한 지남".
- 제목 14/600, crumb 12px, "(달력 아이콘) M.DD(요일) 마감" 12px.
- 하단(구분선 #EEF2F1)
  - mine: 내 상태 아이콘 15 + "내 상태 · {라벨}". M이면 "미제출 · 기한이 지났어요". 색은 CODE_COLOR.
  - team: 아바타 26 스택(최대 4, +N 28) + 우측 "sub/asg 제출"(또는 "담당자 미정").
- 카드 클릭 → goLeaf(4절 참고).

## 2-D. 캘린더 탭

툴바
- 제목 20/700, min-width 128. 월간 "2026년 10월", 주간 "10.11 – 10.17".
- 이전/다음 38px 원 버튼: 월간은 ±1개월, 주간은 ±7일.
- "오늘" 버튼 → anchor = TODAY.
- 우측 세그먼트 월간/주간.
- 위 조작은 모두 calPick 해제.

참가자 필터 칩
- "전체" | "내 과제만" | 나 외 멤버 각각(아바타 22, padding-left 6).
- 특정인을 고르면 그 사람 담당 과제만 표시. 막대 색은 그 사람 코드 기준, 끝 아이콘도 그 사람 것만.

그리드
- border, radius 16. 요일 헤더 bg #F7FAF9, 12/600, 일 #C0453A, 토 #2F5BC2.
- 주 행: min-height 월 112 / 주 240, 행 사이 border #EEF2F1.
- 날짜 셀
  - padding 6 8, 세로 구분선 #EEF2F1.
  - bg: 오늘 #F4FBF8, 다른 달 #FAFBFB.
  - 숫자 원 26: 오늘 = 검정(#1B2230) 원 + 흰 700. 다른 달 #A7B0BA, 일 #C0453A, 토 #2F5BC2.
  - 주간 모드는 숫자를 "M.D" 형식으로.
  - 회차 시작일 마커: 라벨 배지(10/700, 흰 on #22264B), title "{라벨} {제목} 시작".
- 막대 영역: grid 7열, auto-rows 26, row-gap 4, padding-top 38.
  - 레인 배치: 시작열 순, 같으면 긴 것 먼저. 겹치지 않는 첫 레인에 배치.
  - 막대: 12px, 시작·끝에만 radius 7과 margin 5. 진행·지연은 700.
  - 주를 넘겨 이어지는 조각은 라벨 뒤에 "(계속)". 단 0열에서 시작하는 조각은 원제목.
  - 끝 조각에 담당자 상태 아이콘 13(최대 3) + "+N".
  - 막대 색 BAR [bg, 글자, border]
    - 완료 #E6F4EC / #1A6B47 / 1px #BFE3CF
    - 진행 #DDF4EE / #0B6553 / 1.5px #12A386
    - 지연 #FCEBE9 / #A3302A / 1.5px #D64545
    - 예정 #FFF / #4A5563 / 1px dashed #8C97A4
    - 미배정 #FFF / #7A4F00 / 1px dashed #C98A00
  - hover shadow 0 3px 8px rgba(27,34,48,.18).
  - title "{crumb} · {title} (M.DD–M.DD)".
  - 클릭 → calPick.

과제 상세 팝오버 (role=dialog)
- absolute top 48 right 12, 폭 300(max 100%−24), radius 16, shadow 0 16px 40px rgba(27,34,48,.18), padding 16.
- 유형 배지 + 제목 15/700 + X 닫기.
- crumb 12px.
- "M.DD(요일) – M.DD(요일) · **D-n / 전원 제출**".
- 사람 리스트: bg #F7FAF9, radius 10. 아바타 28 + 이름(나면 "(나)") + 상태 라벨 컬러.
- 담당자 0명이면 "아직 담당자가 없어요".
- 버튼 "커리큘럼에서 보기"(42, #22264B) → goLeaf.

범례(12px)
- 진행중 / 완료 / 지연(미제출 있음) / 예정 막대 견본(24×12).
- "2주차" 배지 = 회차 시작.
- "· 막대 끝 아이콘 = 담당자별 제출 상태".

## 2-E. 간트 탭

툴바
- 세그먼트 "일 단위"(기본, 하루 28px) / "주 단위"(하루 10px).
- 범례 22×12 견본: 완료 #1E9E6A 채움 / 진행 #BDE9DC + 1.5px #12A386 / 지연 #F7D4D0 + 1.5px #D64545 / 예정 흰색 + dashed #8C97A4 / 오늘 2×14 #D64545 세로선

구조
- 가로 스크롤 박스(.thin-scroll), border, radius 16.
- inner width = 300 + nDays×dw. 범위 = 루트 최소 시작일이 속한 주 일요일 ~ 루트 최대 종료일이 속한 주 토요일.
- 헤더 64px
  - 좌측 sticky 300px "목표 · 과제"(bg #FAFCFB, 12/600).
  - 트랙: 월 라벨 12/700(top 0, h 26, 좌측 경계선 #E4ECEA).
  - 일 단위 틱: 매일 숫자 11px. 일 #C0453A, 토 #2F5BC2, 오늘 700.
  - 주 단위 틱: 일요일마다 "M.DD".
  - "오늘" 태그(흰 on #D64545, 10/700, bottom 4).
- 행 44px, border #EEF2F1.
  - 좌측 sticky 300px: depth0 bg #FAFCFB, 들여쓰기 depth×16. 보관 opacity .55.
  - chevron 26 버튼 → 펼침/접힘. closed 상태를 커리큘럼 탭과 공유함.
  - 제목 버튼(13px, 회차 배지 11/700 on #22264B): 리프 클릭 → goLeaf. 부모 클릭 → 토글.
  - 부모: 우측 "{pct}%" 12/700.
  - 리프: 상태 아이콘 13 최대 4 + "+N".
- 트랙
  - 주 경계 세로선 repeating-linear-gradient #EEF2F1, 간격 7×dw.
  - 오늘선: 2px #D64545, opacity .55.
  - 부모 막대: top 17, h 10, radius 5, 트랙 #DCE5E2. 채움 depth0 #22264B, 그 외 #4A5563, 폭 pct%.
  - 리프 막대: top 10, h 24, radius 6, 11/700 가운데 정렬. 색은 GBAR: complete #1E9E6A 흰 글자 / progress #BDE9DC·#0B6553·1.5px #12A386 / delayed #F7D4D0·#A3302A·1.5px #D64545 / planned 흰·#4A5563·dashed #8C97A4 / unassigned 흰·#7A4F00·dashed #C98A00
  - 리프 막대 텍스트: 폭 ≥44px일 때만 "sub/asg"(담당자 없으면 "미정").
  - 막대 x = 일차×dw + 2, w = 일수×dw − 4.
- 하단 문구: "읽기 전용이에요. 일정 변경은 커리큘럼 탭의 편집 모드(그룹장)에서 할 수 있어요. 과제 이름을 누르면 커리큘럼에서 상세를 볼 수 있어요."

# 3. 상태 / 아이콘 체계

과제 담당자 코드
| 코드 | 의미 | 아이콘 | 라벨 색 |
|---|---|---|---|
| D | 기한내 제출 | 채운 원 #1E9E6A + 흰 체크 | #1A7F55 |
| L | 지각 제출 | 채운 원 #C98A00 + 흰 시계바늘 | #8A5A00 |
| M | 미제출(마감 경과) | 채운 원 #D64545 + 흰 ! | #C0392B |
| O | 진행중 | 흰 원, stroke #6B7684 1.8 | #3A4452 |
| P | 예정 | 흰 원, stroke #8C97A4 1.6, dasharray 2.2 1.8 | #5B6675 |
| - | 미배정 | 표시 안 함 | — |

- 코드 ↔ 공용 StatusIcon: D=done, L=late, M=missed, O=open, P=planned.
- 아바타 위에 올라가는 아이콘에는 흰 stroke 1.6 링(둘러싼 흰 원)이 있습니다.
- 크기: 개요 15, 트리 14, 팀 카드 13, 캘린더·간트 13, 보드-내상태 15.

과제 state 판정
- 담당 0명 → unassigned
- 전원 D/L → complete
- 시작일 > 오늘 → planned
- 마감일 < 오늘 → delayed
- 그 외 → progress

자동 코드 채우기: 공통 과제는 '-' 자리를 자동으로 채웁니다(시작일 > 오늘이면 P, 아니면 O). 지정 과제에서 assignOv에 새로 넣은 사람도 같은 규칙입니다.

진척 집계
- 부모 pct = Σsub / Σasg (보관 제외). 전체 = 루트 합계 기준.

"이탈"은 참가자 목록 태그일 뿐입니다(도윤: dim 아바타, "–"). 과제 코드에는 없습니다.

D-day 표기: 0이면 "D-DAY", 미래 "D-n", 과거 "D+n".

# 4. 상태(state) 모델과 공통 동작
- 초기값: sel 'aws', tab 'overview', curMode 'view', bMode 'mine', bRound 'all', calMode 'month', calWho 'all', zoom 'day'.
- 펼침 상태: closed {id: true} = 접힘. 기본은 전부 펼침.
- 편집 오버라이드 맵: titles, dates, typeOv, assignOv, added(부모 id 또는 'root' → 제목 배열), removed, archived. 모두 클라이언트 메모리 전용이고 저장은 연출입니다.
- 노드 id: 루트 인덱스 "0", 하위는 "0.1" 형식.
- goLeaf(id) = {tab: 'curriculum', curMode: 'view', openLeaf: id, closed: {}, calPick: null}. 해당 리프 상세가 펼쳐진 커리큘럼으로 이동합니다. 보드 카드, 캘린더 팝오버, 간트 리프에서 사용합니다.
- 사이드바에서 방 변경 시 리셋 대상: closed, openLeaf, editSel, confirm, saved, 모든 오버라이드, bRound, calAnchor, calWho, calPick. tab, curMode, bMode, calMode, zoom은 유지됩니다. (구현: 방 = URL id 이므로 방 변경은 Link 이동. 유지돼야 하는 tab 등은 `?tab=` 쿼리로 전달하거나 그냥 리셋해도 됨 — 리셋 허용.)
- 캘린더 초기 anchor: TODAY가 과제 범위 안이면 TODAY, 아니면 첫 과제 시작일. 그래서 algo는 7월, sqld는 10월을 보여줍니다.

# 5. 목업 데이터 요약
| id | 제목 | 상태 | 기간 | 그룹장 | 인원 | action | 진척 |
|---|---|---|---|---|---|---|---|
| aws | AWS SAA 자격증 3개월 완주 | 진행중 | 10.01–12.31, D-80 | 민수 | 4/6 | joined | 40% |
| spring | Spring 김영한 로드맵 완강 | 진행중 | 10.05–2027.01.31, D-111 | 지훈 | 5/5 마감 | joined | 40% |
| sqld | SQLD 4주 벼락치기 | 모집중 | 10.26–11.22, 시작까지 D-14 | 가은 | 1/5 | pending(철수 승인 대기) | 시작 전 |
| algo | 알고리즘 매일 1문제 | 종료 | 07.01–09.30 | 현우 | 6/6 | closed | 87% |

방별 부가 정보
- aws: 공개, 승인 후 참가. 태그 AWS(auto)·클라우드(auto)·자격증. 최소 3명 충족.
- spring: 비공개 · 초대 링크로만 참가.
- algo: 바로 참가.

개요 참가자(이름 done/total)
- aws: 민수 2/3(장), 지은 2/4, 철수 2/4(나), 하나 0/4, 도윤(이탈)
- spring: 지훈 3/6(장), 철수 2/6, 소율 3/6, 민재 3/6, 아린 1/6
- sqld: 가은(장, 막대 없음), 철수(나, 승인 대기)
- algo: 현우 13/13(장), 철수 11/13, 보람 12/13, 지성 10/13, 다은 12/13, 유진 10/13

커리큘럼 트리 (코드는 멤버 순서대로)
- aws (멤버 민수·지은·철수·하나)
  - 1주차 IAM·VPC 10.01–10.07: IAM 정책 이해(공통 DLDM), VPC 실습(공통 DMDM)
  - 2주차 EC2·S3 10.08–10.14: EC2 인스턴스 유형 정리(지정 -DO-), S3 스토리지 클래스 발표자료(지정 ---O)
  - 3주차 고가용성 아키텍처 10.15–10.21: 하위 노드 "로드밸런서 비교" 아래 ALB vs NLB 실습(공통 PPPP). 3단계 예시.
  - 4주차 오토스케일링 10.22–10.28: Auto Scaling 정책 정리(공통 PPPP)
  - 5주차 데이터베이스 10.29–11.04: RDS·Aurora 비교(공통 PPPP), DynamoDB 설계 퀴즈(지정 -P-P)
- spring (멤버 지훈·철수·소율·민재·아린)
  - 1주차 10.05–10.11: 섹션 1~5 정리 노트(DDDDD), 스프링 컨테이너 실습(DLDDM)
  - 2주차 10.12–10.18: 섹션 6~7 정리 노트(DODDO), 싱글톤 컨테이너 실습 코드(PPPPP)
  - 3주차 스프링 MVC 1편: MVC 구조 이해 노트, 서블릿→MVC 리팩토링
  - 4주차 MVC 1편 (후반): MVC 1편 섹션 5~7 노트
- sqld (멤버는 가은만; 철수는 대기 상태라 미포함)
  - 4회차, 과제 9개
  - 2주차 "2과목 기출 풀이 (전반)"이 지정 과제이고 담당자가 없음. 경고 배너와 "담당자 미정" 표시 대상.
- algo (6명)
  - 회차 그룹 3개(1–4주차 구현·그리디, 5–8주차 BFS·DFS·백트래킹, 9–13주차 DP·최단경로)
  - 각 그룹 아래 "{w}주차 문제 풀이" 공통 리프. 7/1부터 7일 간격.
  - 미제출(M): 2주 지성, 5주 유진, 6주 지성, 7주 보람, 9주 철수, 10주 지성, 11주 철수, 12주 다은·유진, 13주 유진. 나머지는 D.

(정확한 날짜·문구·트리 전체는 원본 RoomDetail.dc.html 의 ROOMS/TREE 데이터에서 그대로 옮긴다.)

개요 "이번 회차" tasks
- aws(2주차, 메타 "마감 D-2"): EC2 인스턴스 유형 정리: 지은 done, 철수 open / S3 스토리지 클래스 발표자료: 하나 open
- spring(2주차, D-6): 섹션 6~7 정리 노트: 5명 중 3명 제출 / 싱글톤 컨테이너 실습 코드: 전원 planned → "10.15 시작"

주의: 개요의 rounds·members 숫자는 하드코딩이고 트리 집계와 일치하지 않습니다. 구현에서는 **트리 집계로 통일**한다.

내 다음 마감
- aws: EC2 인스턴스 유형 정리 · 2주차 › EC2·S3 · 지정 과제 · 10.14(수) 23:59 · D-2
- spring: 섹션 6~7 정리 노트 · D-6
- sqld·algo: 카드 없음

# 6. 다른 화면 참조
- Main: 로고, "방 둘러보기", "+ 새 스터디 찾기".
- MySchedule: "내 일정".
- 자기 자신: "내 과제 보기" → 보드 탭(내 칸반), "제출하러 가기" → goLeaf(해당 리프).
- 동작 없는 요소: 공유, 더보기, 알림, 프로필, 검색, 필터, 신청 취소, textarea.

# 7. 반응형
- ≤900px: 앱 height auto; 사이드바가 위, 메인이 아래; 사이드바 max-width 해제; 내부 스크롤 해제 → 페이지 스크롤.
- 데스크톱은 100vh 고정 레이아웃이고 사이드바 목록과 main이 각각 독립 스크롤.
- 메인 안 섹션과 aside는 flex-wrap(460 / 300 basis). 커리큘럼 트리와 편집 패널도 같다(440 / 280).
- 보드는 auto-fit 240px 컬럼. 간트는 가로 스크롤 + 좌측 300px sticky. 캘린더 팝오버는 max-width calc(100% − 24px). 탭바는 overflow-x auto.

# 8. 접근성 메모
- role: tablist/tab(aria-selected), tree/treeitem(aria-level, aria-expanded), group(aria-pressed 세그먼트·칩), dialog, alertdialog, status.
- 상태 아이콘: role=img + aria-label. 아바타 래퍼 title "{이름} · {상태}".
- 검색 label: sr-only 텍스트 "내 스터디 검색".
