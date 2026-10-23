# 설명 속 그림 · 첨부 이미지 미리보기 · MCP 이미지 업로드 · 접기/중첩 목록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 노드(회차·묶음·과제) 설명에서 `![alt](attachment:이름)` 로 같은 노드의 첨부 그림을 보여 주고, 첨부 목록 이미지에 썸네일·확대 미리보기를 붙이고, MCP 로 그림(SVG 포함)을 올릴 수 있게 한다. 덤으로 `:::details 제목` 접기와 중첩 목록.

**Spec:** `docs/superpowers/specs/2026-10-23-md-images-attachments-design.md` (D1~D31 = 권장안 = 구현안, 사용자 승인).

**Architecture:** 묶음 3개, 각각 따로 배포.
- **A 렌더러** — DB 없음. 파서(`inline.ts`·`markdown.ts`) 모델 확장 → `MarkdownView` 가 그림·접기·중첩을 그린다. 노드 설명만 `ImageResolver` 를 받는다. 앱 응답 헤더(CSP `img-src`·nosniff).
- **B 썸네일·라이트박스** — DB 없음. 공용 `imageCheck.ts`, `ImageLightbox`, 첨부 목록 썸네일, 웹 업로드 사전 검사·조각 복사. SVG 는 아직 못 올린다(0045 필요).
- **C 0045 + MCP** — `0045_node_images_upload.sql` 하나. 종류별 한도·SVG·`node_files_set` 3인자 판·업로드 티켓·anon Storage 정책·`api_invoke` op 2개. 웹 SVG 허용 + 저장 경로 base. MCP 도구 2개(`prepare_image_upload`·`finish_image_upload`).

**Tech Stack:** Next.js 16.4.2 (App Router) · React 19 · Tailwind v4 · Supabase PG17 · vitest(`// @vitest-environment jsdom` + `renderToStaticMarkup`) · deno + PGlite SQL 테스트(`npm run test:db`) · `@modelcontextprotocol/sdk`.

## Global Constraints

- 마이그레이션은 **`0045_node_images_upload.sql` 하나**(묶음 C). Task C1 시작 때 `ls supabase/migrations | tail -3` — `0045_*` 가 이미 있으면 멈추고 오케스트레이터와 번호를 다시 정한다. 0001~0044 수정 금지.
- 재정의는 **최신 판을 복사한 뒤 표시한 곳만** 고친다(시그니처·인자명 동일 → GRANT 유지). 복사 원본은 C1 Step 1 에서 grep 으로 확정: `node_file_register` ←0031 · `node_files_set` ←0030 · `api_scope_of`·`api_invoke` ←0037(0038~0044 에 재정의 없음 확인). **재정의 금지**: `api_rate_check`·`api_limits`·`job_cleanup`·`file_register`·`node_doc_target`·`file_orphan_candidates`·`files_select` 정책.
- 새 plpgsql: `security definer set search_path = ''`, 객체 `public.` 접두, 실패는 `perform public.fail(code, 한국어 문구, details)`. 공개 RPC 만 GRANT. 새 표는 RLS on · 정책 없음 · `revoke all … from anon, authenticated`.
- **`service_role`·`createAdminClient` 를 MCP 경로(`src/app/api/mcp/**`·`src/lib/mcp/**`)에서 import 금지** — 테스트로 고정(C4).
- **SVG 는 `<img src>` 로만**(스펙 D15). `dangerouslySetInnerHTML`·`<object>`·`<embed>`·`<iframe>`·inline `<svg>` 로 사용자 파일을 그리지 않는다 — B5 정적 테스트.
- 렌더러는 계속 "데이터 → React 요소". 사용자가 쓴 URL 이 `<img src>` 에 들어가는 길이 없어야 한다.
- 새 npm 의존성 금지. 새 Next API 를 쓰면 먼저 `node_modules/next/dist/docs/` 해당 문서(`headers.md`, `content-security-policy.md`)를 읽는다(AGENTS.md).
- Supabase 는 `src/lib/api/*`·`src/lib/mcp/*` 에서만 import.
- 한 페이지 스크롤 · 터치 ≥ 44px · 390/820/1440 가로 스크롤 없음.
- 메모리: dev 서버·빌드·`supabase start` 전 `vm_stat | grep -E 'free|compressor'`, 한 번에 하나, 끝나면 종료. dev 서버 `npx next dev -p 3700`(먼저 `lsof -iTCP:3700 -sTCP:LISTEN -P`).
- 브라우저 확인은 `ego-browser`(자기 창, 배포판은 마스터 계정). claude-in-chrome 금지.
- 호스티드 Supabase·Vercel 은 건드리지 않는다(`supabase db push`·배포는 사용자 승인 후).
- 커밋 전 게이트(모든 Task): `npm run lint && npx tsc --noEmit && npx vitest run` (+ SQL Task 는 `npm run test:db`). 커밋은 `git commit -- <paths>` 로 자기 파일만(`.context/`·`AGENTS.md`·`docs/00-initial-planning.md` 금지). 메시지 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- 서브에이전트 금지(각 작업자 스스로 실행).

## Review Focus

1. **주입 없음** — 마크다운 어떤 입력도 `<img src>` 에 사용자 문자열을 넣지 못한다. 외부 그림은 불러오지 않는다. 원시 HTML 은 글자.
2. **SVG 안전** — `<img>` 로만, 「원본 열기」 없음, 받기는 download URL, CSP `img-src`.
3. **권한** — 발급·완료 둘 다 `node_doc_target`. anon 정책은 열린 티켓의 정확한 경로만. 완료는 티켓 주인만.
4. **한도·경합** — 이미지 20 / 문서 5 를 등록·저장·발급·완료 네 곳에서 같게. 3인자 `node_files_set` 이 편집 중 MCP 가 붙인 그림을 지우지 않는다.
5. **기존 회귀 없음** — 평탄 목록·표·인용·코드 렌더 결과 동일. 2인자 `node_files_set`·`node_file_register` 기존 SQL 테스트 전부 통과.

---

# A. 렌더러 (스펙 1·4) — DB 없음, 단독 배포

### Task A0: 기준선

- [ ] `git status --short` 확인(남의 수정 파일은 건드리지 않는다). `npm run lint && npx tsc --noEmit && npx vitest run` 통과 기록.
- [ ] `grep -rn "dangerouslySetInnerHTML\|<object\|<embed\|<iframe\|<img\|next/image" src` 결과 기록(현재 0건이어야 B5·A5 전제가 맞다).

### Task A1: 인라인 그림 토큰

**Files:** `src/lib/markdown/inline.ts`, `src/lib/markdown/inline.test.ts`, `src/components/ui/markdown-editor/tableWidget.ts`, `src/components/my-study/MarkdownView.tsx`(Inline 의 img 갈래 = 자리표시만)

- [ ] 실패 테스트 먼저(스펙 §6 인라인 행): attachment·퍼센트 디코딩·잘못된 `%`·external·`javascript:`/`data:` 원문·`!` 선행 순서·alt 200자·`![](attachment:a.png)` 빈 alt·기존 케이스 회귀.
- [ ] `MdInline` 에 `{t:"img", alt, src}` 추가, 정규식 맨 앞 갈래 `!\[([^\]]*)\]\(([^)\s]+)\)`. `safeDecode`(try `decodeURIComponent`, 실패 원문).
- [ ] `tableWidget.ts`: img 토큰 → 텍스트 노드 `[그림: …]`(스펙 §5). `Inline`(MarkdownView): resolver 없으면 `<span className="text-muted">[그림: {alt||name}]</span>`, external 은 `<a …>그림 링크: {alt||href}</a>`.
- [ ] 게이트 + 커밋 `feat(md): 그림 토큰(attachment·external) 파싱`.

### Task A2: 중첩 목록

**Files:** `src/components/my-study/markdown.ts`, `markdown.test.ts`, `MarkdownView.tsx`

- [ ] 실패 테스트: 2칸·표식 폭+1(`"1. a\n   - b"`)·탭·ul/ol/task 섞임·깊이 5 → 4 고정·이어진 줄(들여쓴 비목록 줄)·들여쓰지 않은 비목록 줄은 문단·`3.` → `start: 3`·**기존 평탄 목록 테스트는 `items[i].text` 로만 바꿔 같은 결과**.
- [ ] 모델 `MdItem = { text, done?, sub: MdBlock[] }`(스펙 §3.1). 줄을 `trim()` 하기 전에 들여쓰기 폭을 잰다(탭 4). 목록 스택(`{indent, contentCol, block}`)으로 하위 목록을 붙인다 — 목록 밖 블록 규칙(코드 펜스·표·인용·제목)은 지금 위치 그대로 먼저 본다.
- [ ] `MarkdownView` 목록 렌더를 재귀 `ListBlock`(ul 기호 disc→circle→square, ol `start`, task 하위 동일).
- [ ] `grep -rn "items\b" src --include=*.tsx` 로 `MdBlock` 다른 소비자가 없는지 확인(현재 MarkdownView 하나).
- [ ] 게이트 + 커밋 `feat(md): 중첩 목록`.

### Task A3: 접기 블록 `:::details`

**Files:** `markdown.ts`, `markdown.test.ts`, `MarkdownView.tsx`

- [ ] 실패 테스트: 제목·빈 제목(「펼쳐 보기」)·안쪽 목록/표/코드/그림·중첩 3단계 OK·4단계 여는 줄은 글자·미닫힘은 끝에서 닫힘·코드 펜스 안 `:::` 무시·인용 안·`:::note` 글자.
- [ ] 파서: 펜스 다음, HR 앞에서 `^:::details(?:\s+(.*))?$` 감지 → 깊이 세며 닫는 `^:::$` 까지 모아 `parseMarkdown(body, depth+1)` 재귀(코드 펜스는 모으는 중에도 건너뛴다).
- [ ] 렌더: `<details className="rounded-[10px] border border-line"><summary className="min-h-11 …">` + 펼침 표시 `motion-safe:transition-transform`. summary 는 `Inline`(그림은 자리표시 — summary 안 버튼 금지).
- [ ] 게이트 + 커밋 `feat(md): 접기 블록 :::details`.

### Task A4: MarkdownView 그림 렌더 + ImageResolver

**Files:** `MarkdownView.tsx`, `src/components/my-study/MarkdownView.dom.test.ts`(신규)

- [ ] 실패 DOM 테스트(스펙 §6 렌더 행): resolver 없음 → `<img` 0 · resolver ok → `<img loading="lazy" decoding="async" src=서명URL alt=…>` · missing → 「그림을 찾을 수 없어요」 · loading → 스켈레톤 · 원시 HTML 글자 · 사용자 URL 이 `src` 에 안 들어감(external·`javascript:`·`attachment:https://…` 등 10개).
- [ ] `ImageResolver` prop(스펙 §3.1) 을 컨텍스트 없이 prop drilling(`Block` → `Inline`). 문단에 그림 토큰 하나뿐이면 블록 그림(D6). 그림은 `<button type="button">` 안(`open` 이 없으면 버튼이 아니라 `<span>`), `onError` → `refresh` 1회 후 실패 상자. SVG 는 `bg-white`. `{/* eslint-disable-next-line @next/next/no-img-element -- 서명 URL·SVG 는 next/image 최적화 대상이 아니다(스펙 D17) */}`.
- [ ] 게이트 + 커밋 `feat(md): 노드 첨부 그림 렌더`.

### Task A5: 노드 설명 연결 + 응답 헤더

**Files:** `src/lib/api/nodeFiles.ts`(`nodeImageUrls`), `src/components/my-study/useNodeFiles.ts`(신규), `tabs/NodeAttachments.tsx`(files 를 받는 쪽으로), `tabs/DetailView.tsx`, `tabs/LeafBody.tsx`, `src/lib/files/imageMime.ts`(신규 — `IMAGE_MIME`·`isImageMime`, B1 이 `imageCheck.ts` 에서 재수출), `next.config.ts`, `src/lib/securityHeaders.test.ts`(신규)

- [ ] `nodeImageUrls(files)`: `files` 표에서 `id, object_path` 를 한 번에(`in`), `createSignedUrls(paths, 3600)`(download 없음). 실패 id 는 빠진다.
- [ ] `useNodeFiles(nodeId)` = `{ files, setFiles, resolver }`: 마운트 뒤 `fetchNodeFilesOrEmpty` → 이미지만 `nodeImageUrls` → `resolver.resolve(name)` 은 같은 이름 중 **목록의 마지막**(attached_at 순 정렬이므로 최신, D5). `refresh(id)` = 그 파일만 다시 서명. A 단계의 `open` 은 undefined(B3 에서 채움).
- [ ] DetailView·LeafBody: 훅 하나로 `MarkdownView images={resolver}` + `NodeAttachments files={files} setFiles={setFiles}` (fetch 1회 — 기존 `NodeAttachments` 의 자체 fetch·빼기 로직은 그대로 옮긴다, 빼기 후 refocus 규칙 유지).
- [ ] `next.config.ts` `async headers()` → `source: "/:path*"`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: img-src 'self' data: blob: ${supabaseOrigin}`(`NEXT_PUBLIC_SUPABASE_URL` 없으면 `'self' data: blob:`). 헤더 값 만드는 순수 함수 `src/lib/securityHeaders.ts` + 테스트(로컬 URL·호스티드 URL·없음).
- [ ] 수동: dev 서버 + 로컬 DB 로 PNG 첨부가 있는 회차 설명에 `![](attachment:x.png)` → 그림 표시, 콘솔 CSP 위반 0, 외부 `![](https://…)` 는 링크.
- [ ] 게이트 + 커밋 `feat(md): 노드 설명 그림 · img-src CSP`.

### A 배포 게이트

- [ ] 전체 게이트 + `npx next build`(메모리 확인 후).
- [ ] ego-browser(배포 URL, 마스터 계정): 390/820/1440 — 중첩 목록·접기·그림(PNG/JPG)·공지/소개의 자리표시. 응답 헤더 `curl -sI` 로 CSP·nosniff 확인.
- [ ] 오케스트레이터 검토 → 사용자 승인 후 배포. (DB 변경 없음)

---

# B. 썸네일·라이트박스 (스펙 2) — DB 없음, 단독 배포

### Task B1: 공용 이미지 검사

**Files:** `src/lib/files/imageCheck.ts`, `imageCheck.test.ts`, `src/lib/files/__fixtures__/`(draw.io·Excalidraw·mermaid SVG 3개, 악성 SVG 8개, 위장 파일 2개)

- [ ] 실패 테스트(스펙 §6 검사 행) → `sniffImage(head)`·`svgProblems(text)`·`imageSnippet(name, alt)` 구현(스펙 §3.2 패턴 그대로). 순수 함수, DOM·Node API 없이(`Uint8Array`·`TextDecoder` 만) — 브라우저와 Vercel 함수 둘 다에서 쓴다.
- [ ] 정상 샘플이 거부되면 패턴을 좁힌다(예: `xlink:href="#id"` 허용). 오탐이 남으면 스펙 D27 표에 적고 오케스트레이터에 알린다.
- [ ] 게이트 + 커밋 `feat(files): 이미지 매직바이트·SVG 검사`.

### Task B2: ImageLightbox

**Files:** `src/components/ui/ImageLightbox.tsx`, `ImageLightbox.dom.test.ts`

- [ ] 실패 DOM 테스트(스펙 §6 라이트박스 행). 기존 `useFocusTrap`·`useRefocusOnClose`·ConfirmDialog 테스트 모양을 따른다.
- [ ] props: `{ items: { id, name, size, url, svg }[]; index; onIndex; onClose; onDownload(id) }`. 스펙 §4.3 표 그대로(portal·aria·Esc·배경 클릭·←/→·스와이프·aria-live·스크롤 잠금·reduced-motion).
- [ ] 게이트 + 커밋 `feat(ui): 이미지 라이트박스`.

### Task B3: 썸네일 + 설명 그림 → 라이트박스

**Files:** `tabs/NodeAttachments.tsx`, `tabs/NodeAttachments.dom.test.ts`(신규), `useNodeFiles.ts`, `nodeFiles.ts`(`isImage` 재수출 or `fileBadge` 옆)

- [ ] 실패 테스트: 이미지 줄만 56×56 썸네일 버튼(`aria-label="{이름} 크게 보기"`), SVG 는 `object-contain bg-white`, 썸네일 URL 이 아직 없으면 IMG 배지, `<img` 외 요소 0.
- [ ] `useNodeFiles` 에 라이트박스 상태(`openId`) + `resolver.open` 연결 → DetailView·LeafBody 가 `<ImageLightbox>` 를 한 번 그린다. 받기는 기존 `fileUrl`(download 300s).
- [ ] 게이트 + 커밋 `feat(my-study): 첨부 이미지 썸네일·확대 보기`.

### Task B4: 웹 업로드 사전 검사 · 조각 복사

**Files:** `src/components/my-study/useNodeFileUploads.ts`, `tabs/EditView.tsx`(첨부 줄), 관련 `*.test.ts`

- [ ] 이미지 MIME 파일은 올리기 전 앞 64바이트를 읽어 `sniffImage` — 다르면 그 줄 오류 「파일 내용이 {형식}이 아니에요」(올리지 않는다).
- [ ] 첨부 줄(이미지)에 「조각 복사」(44px) → `navigator.clipboard.writeText(imageSnippet(name))`, 토스트 「설명에 붙여 넣으세요」, 클립보드 실패 시 토스트에 조각 원문.
- [ ] 게이트 + 커밋 `feat(my-study): 그림 업로드 사전 검사·조각 복사`.

### Task B5: 정적 게이트

**Files:** `src/lib/files/noUnsafeEmbed.test.ts`

- [ ] `src/**/*.tsx` 를 읽어 `dangerouslySetInnerHTML`·`<object`·`<embed`·`<iframe` 0건 단언(테스트 파일 제외). A0 기록과 같아야 한다.
- [ ] 게이트 + 커밋 `test: 사용자 파일 임베드 금지 게이트`.

### B 배포 게이트

- [ ] 전체 게이트 + 빌드. ego-browser 390/820/1440: 썸네일, 라이트박스 키보드(Tab 순환·Esc·포커스 복귀)·모바일 스와이프, 설명 그림 → 라이트박스, 받기. 콘솔 오류 0.
- [ ] 승인 후 배포(DB 없음).

---

# C. 0045 + MCP 업로드 (스펙 3) — DB + 웹 + MCP

### Task C0: 스파이크(코드 커밋 없음, 결과는 스펙 §7 에 적는다)

- [ ] 메모리 확인 → `supabase start`(로컬). SQL 편집기로 임시 표·`node_upload_ticket_open` 흉내 함수 + anon INSERT/SELECT 정책을 만든다.
- [ ] Node 스크립트(`$CLAUDE_JOB_DIR/tmp`)로 anon 클라이언트 `createSignedUploadUrl(path)` → 티켓 있는 경로 성공·없는 경로 거부 확인 → `curl -X PUT --data-binary` 업로드 → `storage.objects.owner_id`·`metadata.mimetype/size` 값 기록 → 티켓을 닫은 뒤 같은 서명 URL 로 재업로드가 막히는지(덮어쓰기·만료 판정 시점) 기록.
- [ ] 호스티드·로컬 Storage 의 inline 서명 URL 응답 헤더(`Content-Type`·`Content-Disposition`·`X-Content-Type-Options`·`Content-Security-Policy`) 를 `curl -sI` 로 기록(위협 T3).
- [ ] **게이트:** 서명 업로드가 anon 정책으로 안 되면 스펙 §7 대안(anon 직접 `POST /storage/v1/object/…`)으로 C2·C4 의 curl 명령만 바꾸고 오케스트레이터에 보고. 로컬 DB 원복(`supabase db reset`).

### Task C1: 0045 ① 한도·SVG·node_files_set 3인자

**Files:** `supabase/migrations/0045_node_images_upload.sql`(①②③ 절), `supabase/tests/node-attachments-sql.test.ts`, `supabase/tests/files-sql.test.ts`(SVG 제출 거부 1건)

- [ ] Step 1: `grep -n "function public.node_file_register\|function public.node_files_set\|function public.api_scope_of\|function public.api_invoke" supabase/migrations/*.sql` 로 최신 판 확인(위 Global Constraints 와 다르면 그 판을 쓴다).
- [ ] 실패 테스트(스펙 §6 SQL 두 번째 행).
- [ ] 머리 주석(0030 형식: 스펙 경로·담는 것·재정의 원본·재정의 금지 목록). `node_image_mime_types`·`node_doc_mime_types`·`node_image_limit`·`node_svg_max_bytes` · 버킷 update · `node_file_register` 재정의(MIME·SVG 2MB·미저장 한도 종류별) · `node_files_set` 2인자 재정의(종류별 한도) · 3인자 판 신규(`v_ids := v_ids ∪ (v_cur − p_base)` 뒤 2인자 판과 같은 본문 — 공통 본문은 내부 함수 `node_files_set_core` 로 빼고 두 판이 부른다) · GRANT 3인자 판.
- [ ] `npm run test:db` 전체(기존 node-attachments·orphan·files 그대로 통과).
- [ ] 게이트 + 커밋 `feat(db): 0045 이미지 별도 한도·SVG·node_files_set base`.

### Task C2: 0045 ② 업로드 티켓 · anon 정책 · api_invoke

**Files:** `0045_node_images_upload.sql`(④⑤⑥ 절), `supabase/tests/node-upload-sql.test.ts`(신규), `orphan-objects-sql.test.ts`, `api-invoke-sql.test.ts`

- [ ] 실패 테스트(스펙 §6 SQL 첫·셋째·넷째 행). Storage 객체는 기존 테스트처럼 `storage.objects` 에 직접 insert(메타데이터 포함)로 흉내.
- [ ] `node_upload_tickets` 표·인덱스·revoke · `node_upload_ticket_open` + GRANT anon, authenticated · Storage 정책 2개(`to anon`) · `node_upload_prepare`·`node_upload_commit`(스펙 §3.3 순서 그대로, 사용자 잠금 키 `sgtudy.upload:`) · `api_scope_of` 재정의(+2 op) · `api_invoke` 재정의(스터디 해석 목록 +2, 디스패치 `node_upload_prepare`(`(v_args->>'node')::bigint`, `fileName`, `contentType`, `size`, `replace`), `node_upload_commit`(`uploadId`, `dry`), 감사 summary `{node, contentType, size, replaced, dry}` — **이름 없음**).
- [ ] 회귀: `api_invoke` 기존 op 테스트 전부, 감사 summary 기존 모양.
- [ ] `npm run test:db` + 게이트 + 커밋 `feat(db): 0045 업로드 티켓·anon 서명 정책·api_invoke op`.

### Task C3: 웹 — SVG · 종류별 한도 · 저장 base

**Files:** `src/components/my-study/nodeFiles.ts`(`NODE_FILE_LIMITS = { images: 20, files: 5 }`·`NODE_FILE_HINT`·노드용 `NODE_ACCEPT`), `submission.ts`(EXT_MIME 에 svg 는 **노드용 맵에만**), `useNodeFileUploads.ts`(종류별 개수 판정·SVG 2MB·`svgProblems`), `src/lib/api/nodeFiles.ts`(`setNodeFilesFrom`), 팀·개인 항목 저장 경로(`saveSteps` 를 쓰는 곳 — `grep -rn "setNodeFiles(" src`), 관련 테스트

- [ ] 실패 테스트: 이미지 20 + 문서 5 판정 · SVG 2MB 초과 · SVG 금지 패턴 · 제출 업로드 ACCEPT 에 svg 없음 · 저장이 `p_base` = 편집 시작 때 붙은 id 를 보낸다.
- [ ] 빼기 버튼(보기 상세, 최신 목록 다시 받음)은 2인자 그대로 — 이미 경합 안전.
- [ ] 게이트 + 커밋 `feat(my-study): SVG 첨부·이미지 20개·저장 경합 수정`.

### Task C4: MCP 도구 2개

**Files:** `src/lib/mcp/storage.ts`(신규), `src/lib/mcp/tools.ts`, `src/lib/mcp/format.ts`(결과 문구), `src/lib/mcp/errors.ts`(새 코드의 다음 행동), `src/lib/mcp/tools.test.ts`, `src/lib/mcp/storage.test.ts`, `src/lib/mcp/format.test.ts`

- [ ] 실패 테스트(스펙 §6 MCP 행) — invoke·storage 를 가짜로 주입(`Ctx` 에 `storage?` 추가, 기본값은 실제 anon 구현).
- [ ] `storage.ts`: anon 클라이언트(invoke.ts 와 같은 옵션)로 `signUpload(path)`·`readHead(path, n)`·`readAll(path, max)`. 소스 grep 테스트로 `service_role|createAdminClient|SUPABASE_SERVICE_ROLE_KEY` 0건.
- [ ] `resolveNode`: `resolveTask` 일반화(회차 라벨·제목·묶음·과제, 개인·보관 제외, 후보 20). 기존 `resolveTask` 는 이것 위에 리프 필터만 — 시험 도구 테스트 그대로 통과.
- [ ] `prepare_image_upload`·`finish_image_upload`(스펙 §3.4·§4.5). finish 순서: commit dry → 래스터 head 64B / SVG 전체 ≤2MB → `sniffImage`·`svgProblems` → commit. 검사 실패면 commit 을 부르지 않는다(테스트로 호출 횟수 단언).
- [ ] `errors.ts` 다음 행동: `FILE_NAME_TAKEN` → 「같은 이름을 바꾸려면 replace:true 로 prepare 부터」, `FILE_NOT_READY` → 「prepare 결과의 curl 을 먼저 실행」, `UPLOAD_EXPIRED` → 「prepare 부터 다시」, `FILE_LIMIT_EXCEEDED` → 「웹에서 안 쓰는 그림을 빼세요」.
- [ ] `SERVER_INSTRUCTIONS` 에 한 문장: 그림은 prepare → curl → finish, 설명에서 `![alt](attachment:name)`.
- [ ] tools/list 예산 단언 8,000 → 9,000(주석: 그림 도구 2개 · 스펙 D31). 넘으면 설명을 줄인다.
- [ ] 게이트 + 커밋 `feat(mcp): 그림 업로드 도구(prepare·finish)`.

### Task C5: 로컬 통합 · 배포 준비

- [ ] `supabase start` → 0045 적용(`supabase db reset`) → dev 서버 → 로컬 PAT 로 `claude mcp add`(임시 이름 `sgtudy-local`) → 실제로 SVG·PNG 를 prepare → curl → finish → `curriculum_plan` update 로 설명에 조각 삽입 → 웹에서 그림·라이트박스 확인 → 같은 이름 replace → 그림이 바뀌는지 확인. 웹 편집 화면을 먼저 열어 둔 채 MCP 로 붙인 뒤 저장 → 그림이 남는지(D30).
- [ ] 끝나면 로컬 MCP 등록 제거·dev 서버·supabase 종료.
- [ ] 배포 순서 문서화(이 플랜 맨 아래 "배포"에 체크): ① 사용자 승인 → `supabase db push`(0045) ② Vercel 배포 ③ javis 세션에 사용 안내(도구 이름·curl 필요·SVG 2MB·같은 이름 replace).
- [ ] 게이트 + 커밋(문서·테스트 조각만).

## 배포

| 순서 | 묶음 | DB | 비고 |
|---|---|---|---|
| 1 | A | 없음 | 그림은 PNG/JPG/WEBP/GIF 첨부만 보인다. SVG 는 아직 못 올린다 |
| 2 | B | 없음 | 썸네일·라이트박스 |
| 3 | C | **0045 먼저 push → 그다음 웹 배포** | 웹이 먼저 나가면 3인자 `node_files_set` 이 없어 저장이 실패한다 — 반드시 DB 먼저 |

C 배포 순서(C5, 2026-10-23 로컬 통합 확인 뒤):

- [ ] ① 사용자 승인 → `supabase db push`(0045). **0046 이 이미 호스팅에 있으면 0045 는 번호가 앞이라 `--include-all` 이 필요하다**(0045 는 0046 과 독립 — 순서가 바뀌어 적용돼도 결과 같음)
- [ ] ② Vercel 배포(웹 저장 경로가 3인자 `node_files_set` 을 부른다 — ① 전에 나가면 편집 저장이 실패)
- [ ] ③ 배포 뒤 호스팅 실측: 배포판에서 SVG 첨부 1개 → 설명 그림 · 라이트박스, inline 서명 URL 응답 헤더 기록(스펙 §7 표 마지막 줄)
- [ ] ④ javis 세션 안내: 도구 `prepare_image_upload`(study·node·fileName·contentType·size·replace?) → 결과의 curl 실행(@ 뒤 로컬 경로) → `finish_image_upload(uploadId)` → `preview/apply_curriculum_plan` 의 update `set.descriptionMd` 에 조각 `![alt](attachment:이름)`. SVG 2MB · 그 밖 10MB · 항목당 그림 20 · 같은 이름은 `replace:true` · 이름에 공백·괄호·따옴표·%#? 불가 · MCP 서버를 재연결해야 새 도구가 보인다

## 결정에 따른 변경 (사용자가 권장안을 바꿀 때)

| 바뀌는 결정 | 고칠 Task |
|---|---|
| 외부 이미지 허용(D2) | A1(external → img), A5(CSP `img-src https:`), 위협 T5 재평가 |
| 이미지 한도 값(D18) | C1 `node_image_limit()`, C3 `NODE_FILE_LIMITS` |
| MCP 에서 PDF 등도(D26) | C2 MIME 검사, C4 `contentType` enum |
| base64 1단계 도구 추가(D20) | C4 에 `upload_image_inline`(≤350KB, 라우트 512KB 안) — anon 정책으로 Next 가 대신 업로드 |
