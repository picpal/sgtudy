# 슥터디 (sgtudy)

스터디 그룹 목표·일정 관리 웹. Next.js 16 + Supabase(Postgres RPC · Auth 이메일 OTP · Storage).

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
| 로그인 (이메일 OTP) | `/login` | `src/components/auth/LoginScreen.tsx` |
| 닉네임 설정 | `/onboarding` | `src/components/auth/OnboardingScreen.tsx` |
| 내 프로필 | `/me` | `src/components/auth/ProfileScreen.tsx` |
| 초대 링크 | `/invite/[token]` | `src/components/auth/InviteScreen.tsx` |
| 방 만들기 | `/rooms/new` | `src/components/room-new/NewRoomForm.tsx` |

공용: `src/components/ui`(헤더·알림·아바타·다이얼로그·토스트), `src/lib`(routes·palette·date·types·today·me), `src/lib/api/*`(Supabase RPC 어댑터 — 화면은 `src/data/*.ts` 타입만 본다).

## 배포 (Vercel)

- GitHub `picpal/sgtudy` 가 Vercel 프로젝트 `sgtudy` 에 연결돼 있음.
- `main` push → 프로덕션 자동 배포. 다른 브랜치/PR → 프리뷰 URL 자동 생성.
- 수동 배포: `vercel --prod` (로그인 필요).

## 백엔드 (Supabase)

설계: `docs/backend/{01-decisions,02-domain-and-schema,03-api}.md`, 계획: `docs/superpowers/plans/2026-10-13-backend-*.md`.

```bash
vm_stat | grep -E 'free|compressor'   # 메모리 확인 — 빌드와 동시에 띄우지 않는다
supabase start                          # Docker. API 54321 · DB 54322 · Studio 54323 · Mailpit(메일) 54324
supabase status                         # URL·anon key → .env.local
npm run db:reset                        # migrations + seed.sql 재적용
npm run db:types                        # src/lib/supabase/database.types.ts 생성
npm run test:db                         # PGlite(Deno) SQL 테스트 — Docker 불필요. SUPABASE_URL 등이 있으면 *-db.test.ts 도 실행
npm test                                # Vitest(프론트 순수 함수·어댑터)
```

- 환경변수: `.env.example` 참조. Vercel 에는 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 만.
- 호스팅 프로젝트 Auth 설정: Email OTP 켜기, 템플릿에 `{{ .Token }}`, OTP 길이 6, 만료 600초, 재전송 60초, Redirect URLs 에 `https://sgtudy.vercel.app/**`.
- 로컬 로그인: OTP 메일은 Mailpit(http://127.0.0.1:54324)에서 본다. 시드 사용자 이메일은 `supabase/seed.sql` §1.
- 로컬 DB 테스트(`*-db.test.ts`)를 돌리려면:
  `eval "$(supabase status -o env)"; export SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY`
- 목업 데이터는 `src/data/*.ts` 에 화면별로 분리돼 있어, Phase 7 에서 `src/lib/api/*.ts` 어댑터가 같은 export 시그니처로 교체한다.
- "오늘" 기준일은 DB 의 `kst_today()` 가 공급한다(시드·테스트는 2026-10-12 고정).

- 프론트 어댑터: `src/lib/api/{errors,format,me,notifications,invite,rooms,room-view,my-study,schedule}.ts`. 순수 변환 함수는 `npm test`(Vitest)로 목업 숫자(toeic 8주, aws 24%·D-2, algo 87%)를 회귀 검증한다.
- 로컬 E2E: `docs/superpowers/plans/2026-10-13-backend-05-frontend-integration.md` Task 15 체크리스트(ego-browser, http://localhost:3100, OTP 는 Mailpit).
- Vercel: `vercel env add NEXT_PUBLIC_SUPABASE_URL production` / `vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production` (preview 도 동일). `service_role` 은 넣지 않는다. `.vercelignore` 로 `supabase/`·`docs/` 제외.

### 배포 전 체크리스트 (수동 · 게이트)

Vercel 환경변수:

- [ ] `vercel env ls` — `NEXT_PUBLIC_API_URL` 이 있으면 `vercel env rm NEXT_PUBLIC_API_URL production|preview -y`
- [ ] `NEXT_PUBLIC_SUPABASE_URL` (`https://<ref>.supabase.co`), `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Settings → API → anon public) 를 production · preview 에 `vercel env add`
- [ ] `vercel env ls` 가 두 키 × production/preview 만 보이는지 확인

Supabase 대시보드(호스팅 프로젝트):

| 위치 | 값 |
|---|---|
| Authentication → Providers → Email | Enabled, **Confirm email OFF**(OTP 가 곧 확인), Secure email change 기본 |
| Authentication → Email Templates → Magic Link / OTP | 본문에 `{{ .Token }}` 포함 (예: `<p>인증 코드: <b>{{ .Token }}</b> (10분 안에 입력)</p>`) |
| Authentication → Settings | OTP expiry 600초, OTP length 6, Email rate limit ≥ 30/h, Minimum interval 60초 |
| Authentication → URL Configuration | Site URL `https://sgtudy.vercel.app`, Redirect URLs `https://sgtudy.vercel.app/**`, `http://localhost:3000/**`, `http://localhost:3100/**` |
| Settings → API | anon key → Vercel, service_role 은 로컬 `.env.local` 만 |

### 배포 게이트

1. Vercel 에 `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY` 등록 전에는 `vercel --prod` 금지. 없으면 proxy 가 모든 요청을 비로그인으로 통과시키고(500 은 안 남), 등록하면 비로그인 사용자의 보호 라우트(`/my-study`·`/schedule`·`/me`·`/rooms/new`)를 `/login` 으로 보내는데 `/login` 은 plan 05 전까지 404 — plan 05 전에는 프로덕션 배포 자체를 하지 않는다.
2. Vercel 프로젝트 Node 버전은 22 이상.
3. `supabase db push --include-seed`·`supabase db reset --linked` 절대 금지 — seed 는 로컬 전용(`app.today` 고정, 비밀번호 없는 29명).
