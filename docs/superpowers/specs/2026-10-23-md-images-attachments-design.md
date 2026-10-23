# 설명 속 그림 · 첨부 이미지 미리보기 · MCP 이미지 업로드 · 접기/중첩 목록 — 설계

2026-10-23 · 마이그레이션 0045 · 요청: AWS SAA 스터디(javis 세션)가 회차 설명에 학습 가이드 그림(SVG 다수)을 싣고 싶다.
사용자 승인: 1~4 모두 "권장안대로". 이 문서의 D1~D20 은 **권장안 = 구현안**이다.

## 0. 요약

| 묶음 | 무엇 | DB | 독립 배포 |
|---|---|---|---|
| **A. 렌더러** | `![alt](attachment:이름)` 그림 · `:::details 제목` 접기 · 중첩 목록 | 없음 | O (A 만 배포하면 그림 문법은 "자리표시"로만 보임 → A2 에서 실제 그림) |
| **B. 썸네일·라이트박스** | 첨부 목록의 이미지 썸네일, 클릭 확대(설명 속 그림도 같은 라이트박스) · `img-src` CSP · SVG 첨부 허용(웹) | 0045 의 일부가 필요(SVG 허용) → **B 의 SVG 부분은 C 와 같이** | O (SVG 없이 PNG/JPG/WEBP/GIF 만으로 먼저 배포 가능) |
| **C. 0045 + MCP 업로드** | 이미지 별도 한도 20 · SVG · 업로드 티켓 · MCP 도구 2개 · `node_files_set` 경합 수정 | 0045 | O |

현재 코드 사실(설계의 전제):

- 렌더러는 자체 파서(`src/components/my-study/markdown.ts` → `MdBlock[]`, 인라인 `src/lib/markdown/inline.ts` → `MdInline[]`)이고 화면은 React 요소로만 그린다(`dangerouslySetInnerHTML` 없음). 원시 HTML 은 글자로 남는다. 이 성질은 그대로 지킨다.
- 파서가 줄마다 `trim()` 해서 들여쓰기가 사라진다 → 중첩 목록이 한 단계로 펴진다. 에디터(`markdown-editor/commands.ts` `mergeListMarker`)는 이미 CommonMark 하위 목록 들여쓰기(표식 폭 + 1)를 만든다 — 읽기만 못 한다.
- 노드 첨부(0030·0031): 버킷 `attachments`(private, 10MB, MIME 9종) · 키 `n/{room}/{node}/{uuid}.{ext}` · `files.purpose='NODE_DOC'` · 붙은 것 `attached_at not null` · 한도 `node_file_limit()=5`(모든 종류 합) · 서명 URL 은 `fileUrl()` 이 `download: 이름` 으로 300초.
- MCP(`/api/mcp`): PAT → `api_invoke(token, op, args)` 하나로 DB 게이트웨이. **이 경로에 `service_role` 이 없다**(AI 연동 스펙 §4.2). 라우트 본문 상한 `MAX_BODY_BYTES = 512KB`, `api_invoke` 인자 상한 300KB, `maxDuration = 30`. tools/list 예산 8,000자(tools.test.ts).
- 렌더러 사용처: 노드 설명(DetailView·LeafBody — 같은 화면에 `NodeAttachments` 가 있음), 스터디 소개(OverviewTab·RoomInfo), 공지(NoticeTab·NoticePopup), 제출 본문(SubmissionView), 시험 문항·해설(ExamQuestionView). 댓글(CommentBody)은 `Inline` 만 쓴다.
- 앱에 `<img>` 가 하나도 없다(아이콘은 인라인 SVG 컴포넌트). 응답 헤더(CSP·nosniff) 설정도 없다.

---

## 1. 결정

### A. 렌더러

| # | 결정 | 권장(구현) · 근거 |
|---|---|---|
| D1 | 그림 문법 | `![대체 글](attachment:파일이름)`. 이름은 **퍼센트 인코딩 허용**(`attachment:AWS%20VPC.svg`) — 공백·괄호가 든 웹 업로드 이름도 참조할 수 있게. 디코딩 실패(`%zz`)면 원문 그대로 이름으로 본다. 꺾쇠 형식(`<attachment:a b.png>`)은 받지 않는다(문법 하나만). MCP·웹이 **복사할 조각을 만들어 준다**(§3.4 결과 · §4.2 「조각 복사」) — 사람이 인코딩할 일이 거의 없다 |
| D2 | 외부 이미지 | `![x](https://…)` 는 **불러오지 않는다**. 링크로 그린다: 「그림 링크: x」(새 탭, `rel="noopener noreferrer nofollow"`). 근거: 추적 픽셀·혼합 콘텐츠·핫링크 깨짐·용량 남용을 막고, CSP `img-src` 를 좁게 둘 수 있다(D17). 그 밖의 스킴(`data:`·`javascript:`·`attachment:` 아닌 것)은 **원문 글자 그대로** |
| D3 | 인라인 토큰 | `MdInline` 에 `{ t: "img"; alt: string; src: { kind: "attachment"; name: string } \| { kind: "external"; href: string } }` 추가. 정규식은 `!\[` 를 링크보다 **먼저** 본다(아니면 `!` + 링크로 쪼개진다). alt 는 인라인 서식 없이 평문(최대 200자, 넘으면 자름) |
| D4 | 그림이 풀릴 곳 | `MarkdownView` 에 선택 prop `images?: ImageResolver`. **노드 설명(DetailView·LeafBody)만** 넘긴다. 넘기지 않은 곳(소개·공지·제출·시험·에디터 표 셀)은 그림 토큰을 **자리표시 글자**로: 회색 `[그림: 대체 글]`(대체 글이 없으면 `[그림: 파일이름]`). 근거: 풀 노드가 없다. 조용히 지우면 작성자가 "왜 안 보이지"를 모른다 |
| D5 | 노드 설명에서 이름이 없을 때 | 자리 상자 「그림을 찾을 수 없어요 · 파일이름」(점선 테두리, 높이 44). 편집자에게만이 아니라 모두에게 같게(정보 노출 없음 — 이름은 이미 본문에 있다). 같은 이름이 여러 개면 **가장 늦게 붙은 파일**(`attached_at` 최신) — MCP 의 `replace` 가 같은 이름을 갈아끼우는 모델과 맞다(D16) |
| D6 | 그림 크기·배치 | 문단에 그림 **하나만** 있으면 블록 그림(`<figure>` 없이 `<p>` 안 `display:block`), 아니면 인라인. `max-width:100%` · `max-height: min(560px, 70vh)` · `object-fit: contain` · `loading="lazy"` · `decoding="async"` · `alt` = 대체 글, 비었으면 **파일이름**(빈 alt 로 장식 취급하지 않게). 크기를 모르므로 로딩 중엔 높이 160 의 스켈레톤, 로드 후 실제 비율. SVG 는 흰 바탕(`bg-white`) — 투명 SVG 가 어두운 테마에서 안 보이지 않게 |
| D7 | 그림 누르기 | 그림은 `<button>` 안에 있고 누르면 라이트박스(B). 그림 링크(`[![…](…)](…)`) 같은 중첩은 지원하지 않는다(링크 안 그림 → 그림 글자로) |
| D8 | 접기 블록 | 줄 하나 `:::details 제목` 으로 열고 줄 하나 `:::` 로 닫는다. 안쪽은 **전체 마크다운**(목록·표·코드·그림·접기 중첩). 중첩은 깊이 3까지(넘으면 안쪽 여는 줄을 글자로). 코드 블록 안의 `:::` 는 무시(코드 펜스를 먼저 본다). **닫지 않으면 문서 끝에서 닫는다**(쓰다 만 해설이 통째로 사라지지 않게). 제목 생략 → 「펼쳐 보기」. 제목은 인라인 서식(굵게·코드)만, 그림은 글자로. 기본은 닫힘. `:::` 뒤 다른 단어(`:::note` 등)는 지금은 글자 그대로 — 나중 확장 자리 |
| D9 | 접기 그리기 | 네이티브 `<details><summary>` — 키보드(Enter/Space)·스크린리더 펼침 상태가 공짜. summary 높이 ≥ 44, 펼침 표시 ▸/▾(CSS `rotate`, `prefers-reduced-motion` 이면 전환 없음). 인용(`>`) 안에서도 동작(인용은 이미 재귀 파싱) |
| D10 | 중첩 목록 | 들여쓰기를 센다(탭 = 공백 4). 목록 줄의 들여쓰기가 **직전 항목의 내용 시작 칸 이상**(= 그 항목 들여쓰기 + 표식 폭 + 1, 에디터가 만드는 값)이면 그 항목의 하위 목록. 2칸만 들여도 하위로 본다(`"- a\n  - b"` 와 `"1. a\n  - b"` 둘 다 — 사람·AI 가 흔히 쓰는 모양). 하위 목록의 종류(ul/ol/task)는 섞여도 된다. 깊이 4 까지, 더 깊으면 4단계에 붙인다. 들여쓴 **목록 아닌** 줄이 항목 바로 뒤에 오면 그 항목의 이어진 줄(줄바꿈 유지). 들여쓰지 않은 목록 아닌 줄은 지금처럼 목록을 끝내고 문단(기존 문서 모양 보존). 번호 목록은 첫 번호를 `start` 로 존중(`3.` 부터 시작하면 3) |
| D11 | 모델 변경 | `MdBlock` 의 `ul`·`ol`·`task` 항목을 `MdItem = { text: string; done?: boolean; sub: MdBlock[] }` 로 통일. `{ type: "details"; title: string; blocks: MdBlock[] }` 추가. `ol` 에 `start?: number`. 소비자는 `MarkdownView` 하나 + 테스트 |

### B. 썸네일 · 라이트박스 · 응답 보안

| # | 결정 | 권장(구현) · 근거 |
|---|---|---|
| D12 | 이미지 판정 | `contentType ∈ {image/png, image/jpeg, image/gif, image/webp, image/svg+xml}` (`isImageMime`, 0045 `node_image_mime_types()` 와 같은 목록) |
| D13 | 썸네일 | 첨부 목록(`NodeAttachmentsView`)에서 이미지 줄은 IMG 배지 대신 **56×56 썸네일 버튼**(`object-cover`, 10px 라운드, SVG 는 `object-contain` + 흰 바탕). 버튼 자체가 ≥44 터치 영역. `aria-label="{이름} 크게 보기"`. 줄의 다른 동작(받기·빼기)은 그대로. 별도 갤러리 섹션을 만들지 않는다(목록 하나 — 기존 순서·포커스 규칙 유지). Supabase 이미지 변환(render/image)은 요금제 의존이라 쓰지 않고 원본을 `loading="lazy"` 로 — 10MB 원본 20장이면 무겁다는 건 알려진 비용(§7 위험) |
| D14 | 서명 URL | 미리보기·설명 그림용 **inline URL**(download 옵션 없음) 1시간을 `createSignedUrls(paths, 3600)` 한 번으로 받는다. 대상은 화면에 보이는 노드의 **이미지 파일만**. 받기 버튼은 지금처럼 `download: 이름` 300초(첨부 다운로드 = 저장). `<img onError>` 면 한 번 다시 서명해 바꿔 끼운다(1시간 지나 탭에 둔 경우) |
| D15 | SVG 렌더 규칙 | **`<img src>` 로만**. `inline <svg>`·`<object>`·`<embed>`·`<iframe>`·CSS `background-image`·`fetch → innerHTML` 금지(코드 리뷰·lint 규칙 대신 grep 게이트, 계획 B 게이트). `<img>` 로 그린 SVG 는 스크립트·외부 요청·이벤트 핸들러가 동작하지 않는다(브라우저 secure animated mode). 라이트박스 「원본 열기」 버튼은 **두지 않는다** — SVG inline 서명 URL 을 최상위 탭으로 열면 Storage 출처에서 스크립트가 돈다(위협 T3). 받기는 download URL(첨부로 저장) |
| D16 | 라이트박스 | §4 UI. 한 노드의 이미지들(첨부 목록 순서)을 ←/→ 로 넘긴다. 설명 속 그림에서 열면 그 파일부터 |
| D17 | 앱 응답 헤더 | `next.config.ts` `headers()` 로 모든 경로에 `X-Content-Type-Options: nosniff` + **`Content-Security-Policy: img-src 'self' data: blob: {SUPABASE_ORIGIN}`** (그 외 지시어는 넣지 않는다 — 스크립트 CSP 는 nonce·동적 렌더가 필요해 범위 밖). `SUPABASE_ORIGIN` = `new URL(NEXT_PUBLIC_SUPABASE_URL).origin`(로컬 `http://127.0.0.1:54321`). 앱에 외부 `<img>` 가 없어 깨질 것이 없다(조사: `src` 에 `<img`·`next/image` 0건). 근거: D2 를 렌더러 버그가 있어도 브라우저가 한 번 더 막는다. `next/image` 는 쓰지 않는다(서명 URL 은 매번 달라 최적화 캐시가 무의미하고 원격 패턴·비용만 는다) — `@next/next/no-img-element` 는 해당 줄에 이유와 함께 끈다 |

### C. 0045 · MCP 업로드

| # | 결정 | 권장(구현) · 근거 |
|---|---|---|
| D18 | 한도 | **종류별 별도 한도**: 이미지 **20개** + 그 밖(PDF·ZIP·TXT·MD) **5개**(지금 값 유지). `node_file_limit()` 의 뜻을 "이미지 아닌 것"으로 좁히고 `node_image_limit()=20` 추가. 파일당 10MB 그대로, **SVG 는 2MB**(아래 검사가 통째로 읽으므로 · 학습 그림엔 충분). 근거: 그림 가이드는 회차당 10장 안팎, 문서 한도를 같이 늘리면 저장 용량만 커진다. 오류 문구 「그림은 항목당 20개까지예요」 / 「파일은 항목당 5개까지예요」 |
| D19 | SVG 허용 범위 | 버킷 `allowed_mime_types` 에 `image/svg+xml` 추가(버킷 단위라 전역), 하지만 **등록은 노드 첨부만**: `node_doc_mime_types()` = 기존 9종 + SVG. 제출 첨부(`file_register`, `allowed_mime_types()`)는 그대로 — 제출용 키에 SVG 객체를 올려도 등록이 거부되고 0031 고아 정리가 24h 뒤 지운다 |
| D20 | **업로드 경로 — 2단계(서명 업로드 URL)로 결정** | `prepare_image_upload` → 에이전트가 `curl -X PUT --data-binary @파일` → `finish_image_upload`. **base64 인라인 도구는 만들지 않는다.** 근거 ① base64 는 모델 출력 토큰으로 지나간다: 200KB SVG ≈ 270K 글자 ≈ 수만~10만 토큰 — 10MB 는 원리상 불가능. ② 라우트 본문 상한이 이미 512KB(`MAX_BODY_BYTES`), Vercel 함수 본문 4.5MB — 둘 다 10MB 에 못 미친다. ③ 바이트가 Next 를 거치지 않아 함수 시간·메모리(24GB 기계가 아닌 Vercel 쪽)도 안 쓴다. 대가: 셸이 없는 클라이언트(claude.ai 커넥터)는 업로드 불가 — 그쪽은 웹 업로드를 안내(현재 실사용자는 Claude Code) |
| D21 | `service_role` 없이 서명 | 서명은 Next 가 **anon 키**로 `storage.createSignedUploadUrl(path)` 를 부르고, Storage 의 INSERT RLS 가 `anon` 에게 **열린 티켓이 있는 그 경로 하나만** 허락한다(`node_upload_ticket_open(name)`). 경로의 uuid(122bit)는 DB 가 발급해 그 PAT 사용자에게만 돌려준다 = 능력(capability) URL. 근거: AI 연동 스펙의 "이 경로에 service_role 없음" 원칙 유지. 대안(서버가 service_role 로 서명)은 기각 — 키가 MCP 경로에 들어오면 그 모듈의 버그 하나가 버킷 전체 쓰기가 된다 |
| D22 | 티켓 | 표 `node_upload_tickets`. 발급 시 권한·종류·크기 신고값·한도·이름 충돌을 검사하고, 완료(commit) 때 **실물 메타데이터로 다시** 검사한다(신고값은 믿지 않는다). 유효 2시간(Supabase 서명 업로드 URL 의 고정 수명과 같음), 완료는 발급 뒤 3시간 안. 한 번만 완료(두 번째 완료는 같은 결과를 돌려준다 — 응답을 잃은 재시도 안전) |
| D23 | 완료 = 바로 붙임 | MCP 에는 "편집 저장" 단계가 없다 → 완료하면 `attached_at = now()` 로 **바로 노드에 붙는다**(웹의 미저장 24h 단계 없음). 팀원 알림 없음(웹 첨부와 같음) |
| D24 | 같은 이름 | 붙은 파일 중 같은 이름이 있으면 `FILE_NAME_TAKEN`(다음 행동: `replace:true` 로 다시). `replace:true` 면 완료 때 같은 이름의 붙은 파일들을 DELETED 로 바꾸고 새 파일을 붙인다 → **설명의 `attachment:이름` 참조가 그대로 새 그림을 가리킨다**(그림 고쳐 올리기 반복이 javis 의 주 사용). 웹 업로드는 이름 중복을 막지 않는다(기존 동작) — 렌더러는 D5 규칙 |
| D25 | MCP 파일 이름 규칙 | `^[^\s/\\()\[\]<>%#?"']{1,120}$` + 확장자가 contentType 과 맞을 것(`png`·`jpg|jpeg`·`gif`·`webp`·`svg`). 마크다운 조각을 인코딩 없이 쓸 수 있는 이름만 받는다(한글 가능: `3주차-VPC구성.svg`). 웹은 기존처럼 아무 이름(조각 복사 시 인코딩) |
| D26 | MCP 업로드 범위 | **팀 항목(회차·묶음·과제) 의 이미지만**. 개인 목표 노드 → `PERSONAL_NODE`, 이미지 아닌 종류 → `FILE_TYPE_NOT_ALLOWED`(PDF 등은 웹에서). 스코프는 `curriculum:write`(새 스코프를 만들지 않는다 — 토큰 UI·발급 변경 없음), 실제 권한은 `node_doc_target`(편집자·방 상태·보관) 이 다시 본다 |
| D27 | 매직바이트 · SVG 검사 | `finish` 가 DB `dry` 완료로 경로·실물 메타를 받은 뒤 Next 가 anon 키 + 티켓 SELECT 정책으로 객체를 읽어 검사하고(래스터 = 앞 32바이트 서명, SVG = 2MB 통째로 + 금지 패턴), 통과해야 진짜 완료를 부른다. 웹 업로드는 같은 검사 함수(`src/lib/files/imageCheck.ts`)를 브라우저에서 올리기 전에 돌린다. **이 검사는 방어 심층(defense in depth)이지 경계가 아니다** — PAT 소유자는 `api_invoke` 를 직접 불러 검사를 건너뛸 수 있고 웹 사용자는 Storage 에 직접 올릴 수 있다. 진짜 경계는 D15(그리는 방식)·D17(헤더)·버킷 MIME 목록이다(§2 위협 모델에 명시) |
| D28 | 레이트리밋 | 기존 `api_rate_check`(토큰 분당 60 · HTTP 120) 위에 업로드 전용: **사용자당 시간당 티켓 60개 · 동시에 열린 티켓 10개**(발급 함수 안에서 사용자 advisory 잠금 아래 셈 — 0041 `comment_rate_check` 모양, `api_rate_check` 는 재정의하지 않는다). 초과 → `RATE_LIMITED` + `retryAfterSec` |
| D29 | 고아 | 올렸지만 완료 안 한 객체 = `files` 행이 없음 → 0031 `file_orphan_candidates` 가 24h 뒤 지운다(키가 `node_doc_key_ok` 모양이라 이미 대상). 완료는 객체 생성 3h 안이라 0031 의 23h 등록 거부선과 겹치지 않는다. 티켓 행은 발급 함수가 내 것 중 1일 지난 것을 지운다(`job_cleanup` 재정의 없이 — 0032 와 같은 방식). replace 로 DELETED 된 파일은 기존 `file_purge` 경로 |
| D30 | `node_files_set` 경합 | 지금 웹 편집 화면은 **열 때 받은 목록**으로 저장한다 → 편집 중에 MCP 가 붙인 그림을 저장이 **지운다**(집합 의미). 0045 에 3인자 판 `node_files_set(p_node, p_file_ids, p_base uuid[])` 추가: `p_base` = 편집을 시작할 때 붙어 있던 id. 지우는 것은 `base − ids` 뿐, base 에 없던(그 사이 붙은) 파일은 남긴다. 한도는 합친 결과로 센다. 2인자 판은 그대로(= base 가 현재 전부) — 웹 저장 경로만 3인자로 바꾼다 |
| D31 | tools/list 예산 | 도구 2개(목록 도구 없음 — `finish` 결과가 그 노드의 그림 이름 목록을 함께 준다). 예산 8,000 → **9,000자**로 올리고 테스트 주석에 이유 |

---

## 2. 보안 위협 모델

자산: ① 앱 출처(sgtudy 도메인)의 세션 쿠키·로컬 저장소 ② 첨부 객체(비공개 버킷) ③ 버킷 저장 용량 ④ 다른 사용자의 브라우저.
행위자: (a) 방의 편집자(그림을 올릴 수 있는 사람) — 대체로 믿지만 계정 탈취·실수 가능 (b) 방 멤버(보기만) (c) 외부인 (d) 유출된 PAT·업로드 URL 을 가진 사람.

| # | 위협 | 경로 | 막는 것(겹겹) | 남는 위험 |
|---|---|---|---|---|
| T1 | 설명 마크다운으로 HTML/스크립트 주입 | `![x](javascript:…)`, `<img onerror>`, `:::details <script>` | 파서는 데이터만 만든다 · React 요소로만 그린다 · `src` 는 서명 URL 만(사용자가 쓴 URL 은 `src` 에 들어가지 않는다) · summary·alt 는 텍스트 노드 | 없음(기존 성질 유지 — 렌더러 테스트로 고정) |
| T2 | 악성 SVG 가 앱 출처에서 실행 | SVG 를 inline 삽입·`<object>`·`iframe` | D15: `<img>` 로만 → 스크립트 비실행 · grep 게이트 · CSP `img-src` | 없음(규칙을 어기는 코드가 들어오지 않는 한) |
| T3 | 악성 SVG 를 **최상위 탭**으로 열기 | inline 서명 URL 을 복사해 주소창에 · 라이트박스 「원본 열기」 | 「원본 열기」 없음 · 받기는 `download`(Content-Disposition: attachment) · inline URL 은 1시간 · D27 업로드 검사(스크립트·이벤트 속성·`foreignObject`·외부 참조 거부) · **실행돼도 출처는 `*.supabase.co`** — 앱 쿠키·토큰이 없다(Supabase 세션은 앱 출처 쿠키) | 검사 우회 업로드 + 사용자가 URL 을 직접 열면 Storage 출처에서 스크립트(피싱 화면 정도). 계획 C0 에서 Storage 응답 헤더(CSP·nosniff·Content-Disposition)를 실측해 기록 |
| T4 | 확장자 위장(HTML 을 `.png`) | 웹·MCP 업로드 | 버킷 MIME 목록(`text/html` 불가) · 등록·완료 때 실물 `metadata.mimetype` 재검사 · 매직바이트(D27) · 앱 `nosniff` · `image/*` 응답은 브라우저가 HTML 로 sniff 하지 않는다 | 거의 없음 |
| T5 | 외부 이미지로 추적·핫링크 | `![](https://tracker)` | D2 렌더러가 불러오지 않음 · D17 CSP `img-src` | 없음 |
| T6 | 권한 없는 업로드 | 멤버 PAT · 다른 방 노드 · 보관 노드 · 종료 방 | 발급·완료 둘 다 `node_doc_target`(편집자·방 상태·보관, 방 잠금) · 스코프 `curriculum:write` · 개인 노드 거부 | 없음 |
| T7 | 업로드 URL 유출 | 로그·대화에 남은 서명 URL | 그 경로 하나·2시간·한 번(덮어쓰기 = UPDATE 정책 없음) · 완료는 티켓 주인만(`user_id = 나`) → 남이 올려도 붙일 수 없고 24h 뒤 고아 정리 | 2시간 동안 10MB 1개를 버킷에 쓸 수 있음(용량 남용 미미) |
| T8 | anon 정책 남용 | anon 키(공개값)로 아무 경로나 INSERT/SELECT | 정책이 **열린 티켓의 정확한 경로**만 · 경로 uuid 는 DB 발급(추측 불가) · SELECT 도 같은 조건(완료되면 닫힌다 → 그 뒤엔 기존 `node_doc_object_readable` 만) | 없음 |
| T9 | 저장 용량 남용 | 편집자가 대량 업로드 | 노드당 이미지 20 · 시간당 티켓 60 · 열린 티켓 10 · 파일 10MB(SVG 2MB) · 고아 24h 정리 | 편집자 1명이 시간당 ~600MB 까지(정상 사용 상한으로 수용) |
| T10 | 경합으로 그림이 사라짐 | 웹 편집 저장 vs MCP 완료 | D30 `p_base` | 2인자 판을 쓰는 옛 클라이언트(배포 직후 열린 탭)는 여전히 지울 수 있음 — 새로고침으로 해소 |
| T11 | 이름으로 정보 노출 | 자리표시에 파일 이름 | 이름은 본문에 이미 있다 · 서명 URL 은 읽기 권한(`files_select`·Storage SELECT) 을 통과해야 받는다 | 없음 |
| T12 | 감사 로그에 사용자 문자열 | 파일 이름 | 감사 summary 에 이름을 싣지 않는다(node id · contentType · size · replaced 만) | 없음 |

---

## 3. 스키마 · API

### 3.1 마크다운 모델 (A)

```ts
// src/lib/markdown/inline.ts
export type MdImgSrc = { kind: "attachment"; name: string } | { kind: "external"; href: string };
export type MdInline =
  | { t: "text" | "b" | "i" | "s" | "code"; v: string }
  | { t: "a"; v: string; href: string }
  | { t: "img"; alt: string; src: MdImgSrc };

// src/components/my-study/markdown.ts
export type MdItem = { text: string; done?: boolean; sub: MdBlock[] };
export type MdBlock =
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "p"; lines: string[] }
  | { type: "ul"; items: MdItem[] }
  | { type: "ol"; items: MdItem[]; start?: number }
  | { type: "task"; items: MdItem[] }          // done 필수
  | { type: "quote"; blocks: MdBlock[] }
  | { type: "details"; title: string; blocks: MdBlock[] }
  | { type: "code"; lang: string; text: string }
  | { type: "hr" }
  | { type: "table"; table: TableModel };

// src/components/my-study/MarkdownView.tsx
export type ImageResolver = {
  resolve(name: string): { state: "loading" } | { state: "missing" } | { state: "ok"; fileId: string; url: string; svg: boolean };
  open(fileId: string): void;            // 라이트박스
  refresh(fileId: string): void;         // onError 재서명
};
```

인라인 정규식 추가 갈래(맨 앞): `!\[([^\]]*)\]\(([^)\s]+)\)` → `attachment:` 접두면 `{kind:"attachment", name: safeDecode(rest)}`, `https?://` 면 external, 그 밖은 원문 글자.

### 3.2 웹 어댑터 (B)

```ts
// src/lib/api/nodeFiles.ts 추가
export async function nodeImageUrls(files: Pick<FileMeta, "id">[], client?: Db): Promise<Map<string, string>>
// files 표에서 id → object_path (RLS files_select) → storage.createSignedUrls(paths, 3600) (download 없음)
export const setNodeFilesFrom = (nodeId: string, fileIds: string[], baseIds: string[], client?: Db) =>
  rpc<FileMeta[]>("node_files_set", { p_node: num(nodeId), p_file_ids: fileIds, p_base: baseIds }, client);   // C (D30)

// src/lib/files/imageCheck.ts (웹·MCP 공용, 순수)
export const IMAGE_MIME = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"] as const;
export function sniffImage(head: Uint8Array): (typeof IMAGE_MIME)[number] | null;   // PNG 89504E47 · JPEG FFD8FF · GIF8 · RIFF....WEBP · SVG = 텍스트(BOM·공백·<?xml·주석 뒤 <svg)
export function svgProblems(text: string): string[];   // [] = 통과
export const imageSnippet = (name: string, alt = "") => `![${alt}](attachment:${encodeURIComponent(name).replace(/%2F/g, "/")})`;
```

SVG 금지 패턴(대소문자 무시, 하나라도 있으면 거부): `<script` · `\son[a-z]+\s*=` · `javascript:` · `<foreignObject` · `<iframe|<embed|<object` · `<!ENTITY`·`<!DOCTYPE`(XXE·billion laughs) · `href`/`xlink:href` 값이 `#` 로 시작하지 않는 것(외부·data 참조) · `@import` · `url\(\s*['"]?(?!#)`(CSS 외부 참조). 거부 문구에 걸린 규칙 이름을 싣는다(「SVG 에 스크립트가 있어요(<script>)」).

### 3.3 0045 DB

```sql
-- 제한·목록
node_image_mime_types() → text[]   -- png·jpeg·gif·webp·svg+xml
node_doc_mime_types()   → text[]   -- allowed_mime_types() || 'image/svg+xml'
node_image_limit()      → int 20   -- node_file_limit() 5 는 "이미지 아닌 것" 한도로 뜻만 바뀐다(값·함수 그대로)
node_svg_max_bytes()    → bigint 2097152
update storage.buckets set allowed_mime_types = <0003 9종> || 'image/svg+xml' where id = 'attachments';

-- 재정의 (최신 판 복사 후 표시한 곳만)
node_file_register  ← 0031   -- MIME: node_doc_mime_types · SVG 2MB · 미저장 한도를 종류별로
node_files_set(p_node, p_file_ids) ← 0030   -- 한도 종류별(이미지 20 / 그 밖 5)
api_scope_of        ← 0037   -- +node_upload_prepare·node_upload_commit = 'curriculum:write'
api_invoke          ← 0037   -- 스터디 해석 목록 +2, 디스패치 +2, 감사 summary
-- 새로
node_files_set(p_node bigint, p_file_ids uuid[], p_base uuid[]) → jsonb   -- D30, GRANT authenticated
create table public.node_upload_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  room_id bigint not null references public.rooms(id) on delete cascade,
  node_id bigint not null references public.goal_nodes(id) on delete cascade,
  object_path text not null unique,               -- n/{room}/{node}/{id}.{ext}
  file_name text not null, content_type text not null, size_bytes bigint not null,
  replace boolean not null default false,
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  committed_at timestamptz, file_id uuid           -- 완료 후 files.id (= ticket id)
);  -- RLS on, 정책 없음, revoke all from anon, authenticated
create index on public.node_upload_tickets (user_id, created_at);
node_upload_ticket_open(p_name text) → boolean     -- security definer: 경로 일치 ∧ committed_at is null ∧ expires_at > now(). GRANT anon, authenticated
create policy attachments_insert_upload_ticket on storage.objects for insert to anon
  with check (bucket_id = 'attachments' and public.node_upload_ticket_open(name));
create policy attachments_select_upload_ticket on storage.objects for select to anon
  using (bucket_id = 'attachments' and public.node_upload_ticket_open(name));
node_upload_prepare(p_slug text, p_node bigint, p_name text, p_mime text, p_size bigint, p_replace boolean) → jsonb   -- 내부(api_invoke 만)
node_upload_commit(p_slug text, p_upload uuid, p_dry boolean) → jsonb                                                -- 내부
```

`node_upload_prepare` 순서: `require_user` → `node_doc_target(node, uid, false)`(방 잠금·권한·상태·보관) → 노드의 방 = `p_slug` 의 방(아니면 `NODE_NOT_FOUND`) → 개인 노드 `PERSONAL_NODE` → 이름 규칙(D25, `VALIDATION_FAILED field=fileName`) → MIME ∈ 이미지(`FILE_TYPE_NOT_ALLOWED`) → 확장자↔MIME(`VALIDATION_FAILED field=fileName`) → 크기 1..10MB·SVG 2MB(`FILE_TOO_LARGE`) → 사용자 advisory 잠금 `sgtudy.upload:{uid}` → 내 1일 지난 티켓 삭제 → 시간당 60·열린 10(`RATE_LIMITED`) → 이름 충돌(`FILE_NAME_TAKEN`, replace 면 통과) → 한도: 붙은 이미지 + 이 노드의 내 열린 티켓 − (replace 로 빠질 같은 이름 수) < 20(`FILE_LIMIT_EXCEEDED`) → insert → `{uploadId, objectPath, contentType, size, expiresAt, fileName}`.

`node_upload_commit` 순서: `require_user` → 티켓 `for update`(내 것 아니면 `UPLOAD_NOT_FOUND`) → 이미 완료면 그 파일의 `{file, replaced:[], replayed:true}`(dry 여도 같은 응답) → `created_at` 3h 지남 `UPLOAD_EXPIRED` → `node_doc_target` 재확인 → `storage.objects` 실재(`FILE_NOT_READY` 「아직 업로드가 안 됐어요 — curl 을 먼저 실행하세요」) → 실물 `metadata.mimetype = 티켓 MIME`(`FILE_TYPE_NOT_ALLOWED`)·`metadata.size ≤ 상한`(`FILE_TOO_LARGE`) → 이름 충돌·한도 재검사 → `p_dry` 면 `{objectPath, contentType, size}` 로 끝 → 같은 이름 붙은 파일 DELETED(replace) → `files` insert(id = 티켓 id, purpose NODE_DOC, READY, `attached_at = now()`, owner = 나) → 티켓 완료 표시 → `{file: file_json, replaced: [id…], images: [그 노드의 이미지 이름 목록]}`.

오류 코드(신규): `PERSONAL_NODE`(기존 시험 코드 재사용), `FILE_NAME_TAKEN`, `UPLOAD_NOT_FOUND`, `UPLOAD_EXPIRED`. 기존: `FILE_TYPE_NOT_ALLOWED`·`FILE_TOO_LARGE`·`FILE_LIMIT_EXCEEDED`·`FILE_NOT_READY`·`RATE_LIMITED`·`NODE_NOT_FOUND`·`NOT_CURRICULUM_EDITOR`·`ROOM_NOT_EDITABLE`·`TASK_ARCHIVED`.

### 3.4 MCP 도구 (C)

```ts
// src/lib/mcp/tools.ts
{ name: "prepare_image_upload", title: "그림 올리기 준비",
  description: "[v1] Step 1/2 to attach an image (PNG/JPG/GIF/WEBP/SVG, ≤10MB, SVG ≤2MB) to a curriculum item (회차·과제). "
    + "Returns a one-time upload URL: run the given curl with the local file, then call finish_image_upload. "
    + "Reference it in descriptions as ![alt](attachment:<fileName>).",
  inputSchema: { study, node: z.union([z.string(), z.number().int().nonnegative()]).describe('item id, round ("3주차") or exact title'),
                 fileName: z.string().min(1).max(120), contentType: z.enum(IMAGE_MIME), size: z.number().int().min(1).max(10_485_760),
                 replace: z.boolean().optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }
// 결과(한국어 줄): uploadId · 만료 시각(KST) · 실행할 명령 1줄
//   curl -sS -X PUT -H 'Content-Type: image/svg+xml' -H 'x-upsert: false' --data-binary @'<fileName>' '<signedUrl>'
//   · 다음: finish_image_upload(uploadId) · 설명에 넣을 조각 ![](attachment:<fileName>)

{ name: "finish_image_upload", title: "그림 올리기 완료",
  description: "[v1] Step 2/2: verify the uploaded file and attach it. Safe to retry with the same uploadId.",
  inputSchema: { uploadId: z.string().uuid() },
  annotations: { readOnlyHint: false, destructiveHint: true /* replace 시 옛 파일 */, idempotentHint: true, openWorldHint: false } }
// 흐름: invoke("node_upload_commit",{uploadId, dry:true}) → anon storage download(objectPath) → sniffImage/svgProblems
//   → 통과면 invoke("node_upload_commit",{uploadId}) → "붙였어요: <이름> (n KB) · 조각 … · 이 항목의 그림: a.svg, b.png …"
//   → 불통이면 isError + 이유(객체는 고아로 남아 24h 뒤 정리 — 같은 이름으로 다시 prepare 하면 된다)
```

- 노드 해석: `resolveTask` 를 일반화한 `resolveNode` — 숫자면 그대로, 아니면 `curriculum_get` 트리에서 **회차 라벨·제목, 묶음·과제 제목** 정확 일치(보관·개인 제외), 유일할 때만. 후보 20개까지 안내(시험 도구와 같은 모양).
- 서명: `src/lib/mcp/storage.ts` — anon 클라이언트(`invoke.ts` 와 같은 설정)로 `createSignedUploadUrl(objectPath)`·`download(objectPath)`. 이 파일에 `service_role`·`createAdminClient` import 금지(테스트로 고정).
- 크기 신고값(`size`)은 발급 검사용일 뿐, 완료 때 실물로 다시 본다.
- `finish` 의 다운로드는 SVG 만 통째로(≤2MB), 래스터는 `download` 대신 Range 요청 앞 64바이트(서명 URL `createSignedUrl` + `fetch(Range)`) — 함수 메모리·시간을 아낀다.

---

## 4. UI

### 4.1 설명 속 그림 (A2·B)

- 로딩: 높이 160, `bg-surface-2` 스켈레톤(`motion-safe:animate-pulse`). 로드 뒤 실제 크기(D6). 실패 2번째: 자리 상자 「그림을 불러올 수 없어요」.
- 그림 버튼: 포커스 링(기존 `focus-visible` 토큰), `aria-label` 없음(내부 `<img alt>` 가 이름이 된다) + 시각 숨김 「크게 보기」.
- 같은 노드 화면에서 첨부 목록과 설명이 **같은 파일 목록·같은 서명 URL**을 쓴다: `useNodeFiles(nodeId)` 훅을 DetailView·LeafBody 로 끌어올리고 `NodeAttachments` 는 `files` 를 받는 쪽으로(지금 각자 fetch → 한 번).

### 4.2 첨부 목록 썸네일 (B)

- 이미지 줄: [56×56 썸네일] [이름 / 크기] [받기] [빼기]. 썸네일은 `<button>` — 누르면 라이트박스.
- 웹 편집(EditView 첨부 업로드 줄)의 이미지 줄에 「조각 복사」 버튼: `imageSnippet(name)` 을 클립보드로, 토스트 「설명에 붙여 넣으세요」. (에디터에 그림 삽입 버튼은 만들지 않는다 — 같은 노드 첨부만 참조할 수 있다는 규칙을 버튼 하나로 설명하기 어렵다. 나중 확장.)
- 안내 문구 `NODE_FILE_HINT` → 「그림(PNG·JPG·GIF·WEBP·SVG) 20개 · 파일(PDF·ZIP·TXT·MD) 5개 · 파일당 10MB(SVG 2MB)」. `ACCEPT`(노드 첨부용)에 `image/svg+xml,.svg` 추가(제출 첨부 ACCEPT 는 그대로).

### 4.3 라이트박스 `ImageLightbox` (B)

| 항목 | 동작 |
|---|---|
| 구조 | `createPortal` 로 body 아래 고정 오버레이. `role="dialog" aria-modal="true" aria-label="{이름} ({i}/{n})"`. 배경 `bg-black/85` |
| 열기 | 썸네일·설명 그림 클릭/Enter/Space. 열린 직후 포커스 = 닫기 버튼 |
| 닫기 | Esc · 닫기 버튼(우상단 44×44, `aria-label="닫기"`) · 배경(그림 밖) 클릭 · 모바일 아래로 끌기는 만들지 않는다. 닫히면 **연 요소로 포커스 복귀**(`useRefocusOnClose`) |
| 포커스 트랩 | `useFocusTrap`(ConfirmDialog 와 같은 훅). 안의 포커스 요소: 이전 · 다음 · 받기 · 닫기 |
| 넘기기 | ←/→ 키, 이전/다음 버튼(좌우 가운데 44×44, 1장이면 숨김), 끝에서 멈춤(순환 없음), 모바일 가로 스와이프(포인터 이벤트, 50px 이상 · 세로 이동이 더 크면 무시). 바뀔 때 `aria-live="polite"` 로 「{i}/{n} {이름}」 |
| 그림 | `max-w-[calc(100vw-32px)] max-h-[calc(100dvh-136px)] object-contain`, SVG 는 흰 바탕 + 16px 안쪽 여백. 로딩 스피너, 실패 시 「그림을 불러올 수 없어요」 + 받기 |
| 아래 막대 | 이름(한 줄 말줄임) · 크기 · 「받기」(download URL) |
| 스크롤 | 열린 동안 `body` 스크롤 잠금(닫을 때 원래 값 복원), iOS `overscroll-behavior: contain` |
| 확대 | 자체 줌 없음. 모바일 핀치는 브라우저 기본(뷰포트 확대)에 맡긴다 — 작은 글씨 SVG 는 받기로 |
| 모션 | 페이드 150ms, `prefers-reduced-motion` 이면 없음 |
| 폭 | 390 / 820 / 1440 에서 가로 스크롤 없음, 버튼이 그림을 가리면 그림 위 반투명 원형 버튼 |

### 4.4 접기·중첩 목록 (A)

- 접기: 테두리 `border-line` 10px 라운드, summary 는 `min-h-11 px-3 font-semibold`, 펼친 본문 `px-3 pb-3` 안에 같은 블록 간격(10px). 인쇄용 펼침은 하지 않는다.
- 중첩 목록: 하위 목록 `pl-5`, ul 단계별 기호 disc → circle → square → square, ol 은 decimal 유지. task 하위도 같은 체크 표시.

### 4.5 MCP 결과 문구 (C) — 예

```
그림 올리기 준비 완료 · aws 3주차 「VPC 설계」 · 2시간 안에 올려 주세요(~ 15:42 KST)
실행: curl -sS -X PUT -H 'Content-Type: image/svg+xml' --data-binary @'vpc-구성.svg' 'https://…/upload/sign/…'
다음: finish_image_upload(uploadId: "6f1c…")
설명 조각: ![](attachment:vpc-구성.svg)
```
```
붙였어요 · vpc-구성.svg (84 KB, SVG) · 같은 이름의 이전 그림 1개를 바꿨어요
설명 조각: ![](attachment:vpc-구성.svg)
이 항목의 그림(3/20): vpc-구성.svg, subnet.png, sg-흐름.svg
```

---

## 5. 다른 화면에서의 그림 문법 (D4 정리)

| 화면 | 그림 | 접기 · 중첩 목록 |
|---|---|---|
| 노드 설명(회차·묶음·과제·개인 목표 — DetailView·LeafBody) | **실제 그림**(그 노드의 첨부) | O |
| 스터디 소개(OverviewTab·RoomInfo — 비로그인 공개 화면 포함) | 자리표시 `[그림: …]` | O |
| 공지(NoticeTab·NoticePopup) | 자리표시 | O |
| 제출 본문(SubmissionView) | 자리표시(제출 첨부는 다른 권한 — 나중 별도) | O |
| 시험 문항·해설(ExamQuestionView) | 자리표시(문항 첨부는 나중) | O — 해설 접기에 바로 쓸 수 있다 |
| 댓글(CommentBody, `Inline` 만) | 자리표시 | 블록 문법 없음(그대로) |
| 에디터 표 셀(tableWidget) | 자리표시 글자 | — |
| MCP `get_curriculum(includeDescriptions)` | 원문 그대로 | 원문 그대로 |

---

## 6. 테스트 계획

| 층 | 파일 | 무엇 |
|---|---|---|
| 인라인 | `src/lib/markdown/inline.test.ts` | `![a](attachment:x.svg)` → img · 퍼센트 디코딩 · 잘못된 `%` 원문 · `![a](https://…)` external · `![a](javascript:x)` 원문 글자 · `!` 뒤 링크 순서 · alt 200자 자름 · 기존 링크·서식 회귀 |
| 블록 | `src/components/my-study/markdown.test.ts` | 중첩(2칸·표식 폭+1·탭, ul↔ol↔task 섞임, 깊이 5→4 고정, 이어진 줄, `3.` start) · 기존 평탄 목록 결과 동일(모델만 바뀜) · details(제목·빈 제목·중첩 3·4단계 글자·미닫힘·코드 펜스 안 `:::`·인용 안·표·그림 포함) |
| 렌더 | `src/components/my-study/MarkdownView.dom.test.ts`(신규, jsdom + renderToStaticMarkup) | resolver 없으면 `<img` 0개·자리표시 문구 · resolver 있으면 `<img loading="lazy" decoding="async" src=서명URL alt>` · external 은 `<a>` 이고 `<img` 0개 · `<details><summary>` · 원시 HTML(`<script>`, `<img onerror>`) 글자로 · 그림 `src` 에 사용자 문자열이 절대 안 들어감(fuzz 10개) |
| 검사 | `src/lib/files/imageCheck.test.ts` | 매직바이트 5종 · 위장(HTML·ZIP 을 png 로) · SVG 금지 패턴 각각(대소문자·공백 변형·`xlink:href="data:`·`<!ENTITY`) · 정상 SVG(draw.io·Excalidraw·mermaid 출력 샘플 3개 `src/lib/files/__fixtures__`) 통과 · `imageSnippet` 인코딩 |
| 라이트박스 | `src/components/ui/ImageLightbox.dom.test.ts` | Esc 닫힘 · 포커스 첫 요소 · Tab 순환 · 닫힌 뒤 연 버튼 포커스 · ←/→ · 1장일 때 이전/다음 없음 · aria-label/aria-live 문구 · body 스크롤 복원 |
| 첨부 목록 | `NodeAttachments.dom.test.ts`(신규) | 이미지만 썸네일 · SVG `object-contain` · 썸네일 `<img>` 만(inline `<svg>`·`<object>` 0) |
| 정적 게이트 | `src/lib/files/noInlineSvg.test.ts` | `src/**/*.tsx` 에 `dangerouslySetInnerHTML`·`<object`·`<embed`·`<iframe` 0건(기존 0건 확인 후 고정) |
| SQL | `supabase/tests/node-upload-sql.test.ts`(신규) | prepare: 편집자 OK · 멤버 `NOT_CURRICULUM_EDITOR` · 다른 방 slug `NODE_NOT_FOUND` · 개인 `PERSONAL_NODE` · PDF `FILE_TYPE_NOT_ALLOWED` · 이름 규칙 · 확장자 불일치 · 11MB·SVG 3MB · 이름 충돌/replace · 한도 20(열린 티켓 포함) · 시간당 61번째 `RATE_LIMITED` · 열린 11번째 · 1일 지난 티켓 정리. commit: 객체 없음 `FILE_NOT_READY` · 실물 MIME 다름 · 실물 크기 초과 · dry 는 행 없음 · 완료 후 `attached_at` · replace 로 옛 파일 DELETED · 재호출 replayed · 3h 지남 `UPLOAD_EXPIRED` · 남의 티켓 `UPLOAD_NOT_FOUND` · 방 종료 후 완료 거부. `node_upload_ticket_open`: 열린/완료/만료/다른 경로 |
| SQL | `node-attachments-sql.test.ts` 추가 | 종류별 한도(이미지 20 + 문서 5 동시) · SVG 등록(노드 OK, `file_register` 거부) · SVG 2MB · 3인자 `node_files_set`: base 밖 새 파일 유지·base 안 빠진 것만 삭제·합친 결과 한도 · 2인자 판 기존 테스트 전부 그대로 통과 |
| SQL | `orphan-objects-sql.test.ts` 추가 | 완료 안 한 티켓 객체 24h 뒤 후보 · 완료된 것은 후보 아님 |
| SQL | `api-invoke-sql.test.ts` 추가 | 새 op 스코프(read 토큰 거부) · 감사 summary 에 이름 없음 |
| MCP | `src/lib/mcp/tools.test.ts` 추가 | 예산 ≤ 9,000 · prepare 결과 문구(curl·조각·만료) · finish 흐름(dry → 검사 → commit 순서, 검사 실패 시 commit 미호출) · replayed · 노드 해석(회차 라벨·제목·모호) · `storage.ts` 에 service_role 없음(소스 grep) |
| 통합(로컬) | 수동 + `supabase start` | 실제 `createSignedUploadUrl` 이 anon + 티켓 정책으로 성공 · 티켓 없는 경로 거부 · curl PUT → finish → 화면에 그림 · 응답 헤더 기록(C0) |
| 브라우저 | ego-browser(마스터 계정, 배포 URL) | 390/820/1440: 설명 SVG·PNG 표시, 라이트박스 키보드·스와이프, 접기, 중첩 목록, 콘솔 CSP 위반 0 |

---

## 7. 남은 위험 · 나중

- **anon Storage 정책 동작 가정**: `createSignedUploadUrl` 이 호출자(anon) 의 INSERT RLS 로 판정하고, 업로드 시점에 티켓 만료를 다시 보지 않을 수 있다(서명 수명 2h 로 제한됨). 계획 C0 스파이크에서 로컬로 확인하고, 다르게 동작하면 대안 = anon 키로 직접 `POST /storage/v1/object/attachments/{path}`(업로드 시점 RLS) — curl 명령만 바뀐다.
- **썸네일 무게**: 원본을 그대로 줄여 그린다. 10MB PNG 20장 노드는 모바일에서 무겁다 → 업로드 안내에 "그림은 1MB 이하 권장", 나중에 업로드 시 브라우저 리사이즈 또는 Supabase 이미지 변환.
- **SVG 검사 우회**(D27): 방어 심층일 뿐. 경계는 `<img>` 렌더 · 「원본 열기」 없음 · Storage 출처 분리.
- **D30 옛 탭**: 배포 직후 열려 있던 편집 화면은 2인자 판으로 저장해 MCP 그림을 지울 수 있다.
- **claude.ai 커넥터**: 셸이 없어 2단계 업로드를 못 한다.
- 나중: 에디터 「그림 넣기」 버튼, 공지·시험 문항 첨부 그림, `:::details+`(기본 펼침), 이미지 리사이즈.
