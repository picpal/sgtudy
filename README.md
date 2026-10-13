# 슥터디 (sgtudy)

스터디 그룹 목표·일정 관리 웹. 현재는 목업 데이터 기반 프론트엔드.

- 프로덕션: https://sgtudy.vercel.app
- 디자인 스펙: `docs/claude-design-prompt.md`, 화면별 구현 스펙 `docs/specs/*.md`

## 개발

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # 프로덕션 빌드 (배포 전 통과 확인)
npm run lint
```

## 화면 ↔ 라우트

| 화면 | 라우트 | 담당 폴더 |
|---|---|---|
| 방 목록 | `/` | `src/components/main`, `src/data/rooms.ts` |
| 방 상세 (둘러보기) | `/rooms/[id]` | `src/components/room-view`, `src/data/room-view.ts` |
| 내 스터디 | `/my-study/[id]` | `src/components/my-study`, `src/data/my-study.ts` |
| 내 일정 | `/schedule` | `src/components/schedule`, `src/data/schedule.ts` |

공용: `src/components/ui`(헤더·아바타·상태아이콘), `src/lib`(routes·palette·date·types).

## 배포 (Vercel)

- GitHub `picpal/sgtudy` 가 Vercel 프로젝트 `sgtudy` 에 연결돼 있음.
- `main` push → 프로덕션 자동 배포. 다른 브랜치/PR → 프리뷰 URL 자동 생성.
- 수동 배포: `vercel --prod` (로그인 필요).

## 백엔드 (Supabase)

설계: `docs/backend/{01-decisions,02-domain-and-schema,03-api}.md`, 계획: `docs/superpowers/plans/2026-10-13-backend-*.md`.

```bash
vm_stat | grep -E 'free|compressor'   # 메모리 확인 — 빌드와 동시에 띄우지 않는다
supabase start                          # Docker. API 54321 · DB 54322 · Studio 54323 · Inbucket(메일) 54324
supabase status                         # URL·anon key → .env.local
npm run db:reset                        # migrations + seed.sql 재적용
npm run db:types                        # src/lib/supabase/database.types.ts 생성
npm run test:db                         # PGlite(Deno) SQL 테스트 — Docker 불필요. SUPABASE_URL 등이 있으면 *-db.test.ts 도 실행
npm test                                # Vitest(프론트 순수 함수·어댑터)
```

- 환경변수: `.env.example` 참조. Vercel 에는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 만.
- 호스팅 프로젝트 Auth 설정: Email OTP 켜기, 템플릿에 `{{ .Token }}`, OTP 길이 6, 만료 600초, 재전송 60초, Redirect URLs 에 `https://sgtudy.vercel.app/**`.
- 로컬 로그인: OTP 메일은 Inbucket(http://127.0.0.1:54324)에서 본다. 시드 사용자 이메일은 `supabase/seed.sql` §1.
- 로컬 DB 테스트(`*-db.test.ts`)를 돌리려면:
  `eval "$(supabase status -o env)"; export SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY`
- 목업 데이터는 `src/data/*.ts` 에 화면별로 분리돼 있어, Phase 7 에서 `src/lib/api/*.ts` 어댑터가 같은 export 시그니처로 교체한다.
- "오늘" 기준일은 DB 의 `kst_today()` 가 공급한다(시드·테스트는 2026-10-12 고정).
