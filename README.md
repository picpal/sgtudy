# 슥터디 (sgtudy)

스터디 그룹 목표·일정 관리 웹. Next.js 16 + Supabase(Postgres RPC · Auth 이메일+비밀번호, 가입·재설정은 이메일 OTP · Storage).

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
| 로그인 (이메일+비밀번호) | `/login` | `src/components/auth/LoginScreen.tsx` |
| 회원가입 (이메일 코드 → 비밀번호) | `/signup` | `src/components/auth/OtpPasswordFlow.tsx` |
| 비밀번호 재설정 (이메일 코드 → 새 비밀번호) | `/reset-password` | `src/components/auth/OtpPasswordFlow.tsx` |
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
- 로컬 로그인: 기본은 이메일+비밀번호. 가입·비밀번호 재설정 코드 메일은 Mailpit(http://127.0.0.1:54324)에서 본다. 시드 사용자(`supabase/seed.sql` §1)는 비밀번호가 없으니 `/reset-password` 로 만들거나 아래 마스터 계정을 쓴다.
- 비밀번호 정책: 8자 이상, 영문+숫자(`src/components/auth/password.ts` ↔ config.toml `minimum_password_length`·`password_requirements` ↔ 호스팅 `scripts/apply-hosted-auth.sh`). config.toml 변경은 로컬 Supabase 재시작 후 적용된다.
- 비밀번호 변경(`/me`)은 재인증: `reauthenticate()` → 이메일 6자리 코드 → `updateUser({ password, nonce })` (config.toml `secure_password_change = true` ↔ 호스팅 `security_update_password_require_reauthentication`). GoTrue 는 **24시간 안에 만든 세션은 nonce 를 검사하지 않는다** — 가입·재설정 직후 비밀번호 저장이 그래서 되지만, 막 로그인한 세션을 탈취당하면 코드 없이 바꿀 수 있다(남는 위험). 화면은 늘 코드를 받는다.
- 인증 메일 템플릿: `supabase/templates/{magic_link,confirmation,reauthentication}.html`(6자리 `{{ .Token }}`). magic_link 는 가입(기존 계정)·재설정 공용이라 "인증 코드" 로 중립, confirmation 은 새 가입, reauthentication 은 비밀번호 변경 본인 확인. 로컬은 config.toml 로 자동 적용, 호스팅은 `scripts/apply-hosted-auth.sh`(`.env.local` 의 `SMTP_HOST/PORT/USER/PASS/SENDER_EMAIL` 필요, `--dry-run` 으로 먼저 확인). 무료 플랜 기본 발송기는 템플릿 수정이 막혀 있어 커스텀 SMTP(발송 전용 키 — Brevo·SES 등)가 필요하다.
- 로컬 DB 는 호스팅과 같은 PG 17(`[db] major_version = 17`). `supabase link` 는 `supabase/.temp/*-version` 에 호스팅 이미지 버전을 고정하는데, CLI 2.75 에서는 `gotrue-version` 고정이 HS256 키를 거부해 로컬 관리자 API·env 테스트가 깨진다 → link 후 `rm supabase/.temp/gotrue-version`(storage/rest 고정은 유지).
- 로컬 DB 테스트(`*-db.test.ts`)를 돌리려면:
  `eval "$(supabase status -o env)"; export SUPABASE_URL=$API_URL SUPABASE_ANON_KEY=$ANON_KEY SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY`
- 목업 데이터는 `src/data/*.ts` 에 화면별로 분리돼 있어, Phase 7 에서 `src/lib/api/*.ts` 어댑터가 같은 export 시그니처로 교체한다.
- "오늘" 기준일은 DB 의 `kst_today()` 가 공급한다(시드·테스트는 2026-10-12 고정).

- 프론트 어댑터: `src/lib/api/{errors,format,me,notifications,invite,rooms,room-view,my-study,schedule}.ts`. 순수 변환 함수는 `npm test`(Vitest)로 목업 숫자(toeic 8주, aws 현재 회차 33%·D-2 — 전체 달성률은 24%, algo 87%)를 회귀 검증한다.
- 로컬 E2E: `docs/superpowers/plans/2026-10-13-backend-05-frontend-integration.md` Task 15 체크리스트(ego-browser, http://localhost:3100, OTP 는 Mailpit).
- Vercel: `vercel env add NEXT_PUBLIC_SUPABASE_URL production` / `vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production` (preview 도 동일). `service_role` 은 넣지 않는다. `.vercelignore` 로 `supabase/`·`docs/` 제외.

### 테스트 마스터 계정 · 실오픈 전 삭제 체크리스트

테스트는 마스터 계정(닉네임 "마스터")으로 `/login` 에서 이메일+비밀번호로 로그인해 쓴다.

```bash
scripts/master-user.sh create --local    # 또는 --hosted. .env.local 의 MASTER_EMAIL/MASTER_PASSWORD 사용(없으면 생성해 덧붙임)
scripts/master-user.sh delete --hosted   # 실오픈 전
```

- 이메일 기본값 `sgtudy-master@example.com`(예약 도메인 — 메일이 실제로 가지 않음). 비밀번호는 `.env.local` 에만 있고 스크립트는 이메일만 출력한다. 서비스 롤 키는 실행 때 `supabase status`/`supabase projects api-keys` 에서 읽고 디스크에 쓰지 않는다. `.env.local` 은 실행하지 않고 `MASTER_EMAIL`·`MASTER_PASSWORD`·`SUPABASE_PROJECT_REF` 만 읽는다.
- 안전장치: 만들 때 `app_metadata.sgtudy_master = true` 를 붙이고, 이 표식이 없는 기존 사용자는 `create`·`delete` 모두 **거절**한다(주소를 잘못 넣어도 실사용자를 덮어쓰거나 지우지 않음). `--hosted` 는 `@example.com` 만 — 다른 주소는 `--force-email` + `[y/N]` 확인. 로컬 smoke: `supabase/tests/master-user-db.test.ts`(test:db).
- `create` 는 멱등: 이미 있고 표식이 있으면 비밀번호를 `.env.local` 값으로 맞춘다(user_metadata 는 키만 더한다).
- 실오픈 전 체크리스트
  1. 마스터가 리더인 방은 앱에서 삭제, 남의 방 참가는 탈퇴 — 방·멤버·초대·과제·제출·파일은 FK(NO ACTION)라 남아 있으면 `delete` 가 거절하고 남은 행을 보여 준다.
  2. `scripts/master-user.sh delete --hosted` → "지웠어요" 확인(프로필·알림은 함께 지워지고 메일 대기열은 user_id 가 비워진다).
  3. `.env.local` 의 `MASTER_*` 줄 삭제, 공유했던 비밀번호 폐기.

### 인증 · 실오픈 전 체크리스트

- [ ] **CAPTCHA 켜기 (Cloudflare Turnstile)** — 지금 방어는 IP 단위 rate limit 뿐이다(분산 IP credential stuffing·`/signup` 반복으로 메일 쿼터 `rate_limit_email_sent` 30/h 소진 — 그동안 모든 가입·재설정이 막힘). 코드는 준비돼 있다: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 가 있을 때만 `/login`·`/signup`·`/reset-password` 에 위젯(`src/components/auth/Turnstile.tsx`, explicit render·한국어·`interaction-only`)을 그리고 `options.captchaToken` 을 보낸다. 없으면 지금과 똑같다. **순서를 지킬 것** — 호스팅을 먼저 켜면 토큰 없는 프론트의 로그인·가입·재설정이 전부 400 `captcha_failed` 로 막힌다.
  1. (사용자) Cloudflare 대시보드 → Turnstile → 위젯 추가. 도메인 `sgtudy.vercel.app`, `localhost`. 모드는 Managed(권장) 또는 Invisible. 사이트 키·시크릿 키를 받는다.
  2. Vercel **production** 에 `NEXT_PUBLIC_TURNSTILE_SITE_KEY`(사이트 키) 를 `vercel env add`, `.env.local` 에 `TURNSTILE_SECRET_KEY`(시크릿) 를 넣는다. 시크릿은 Vercel 에 넣지 않는다.
  3. 프론트 배포(`NEXT_PUBLIC_*` 는 빌드 때 박히므로 env 추가 뒤 **새로 빌드**해야 한다). 배포본에서 로그인 화면 Network 에 `challenges.cloudflare.com` 이 뜨고, 로그인 요청 본문 `gotrue_meta_security.captcha_token` 이 채워지는지 확인 — 이 시점엔 호스팅이 아직 검사하지 않으니 토큰이 있어도 없어도 통과한다.
  4. `scripts/apply-hosted-auth.sh --dry-run` → `security_captcha_enabled: true`·`provider: turnstile`·`secret: ***` 확인 → `scripts/apply-hosted-auth.sh` 로 적용(마지막 줄 `captcha: True turnstile`).
  5. 배포본에서 로그인·가입 코드 발송·재설정 코드 발송·재전송을 한 번씩 확인. 막히면 되돌리기: Dashboard → Authentication → Attack Protection 에서 CAPTCHA 끄기(또는 `.env.local` 에서 시크릿을 빼고 끄는 PATCH).
  - 토큰을 보내는 호출: `signInWithPassword`(POST `/token?grant_type=password`), `signInWithOtp`(POST `/otp` — 가입·재설정 코드 발송·재전송). GoTrue 는 `/verify`(코드 확인)·`/user`(비밀번호 저장)·`/reauthenticate`(/me 비밀번호 변경 코드, 로그인 세션 필요)는 검사하지 않는다 — `verifyOtp`·`updateUser`·`reauthenticate` 는 그대로. 토큰은 한 번만 쓰므로 매 시도 뒤 위젯을 reset 한다. 오류 `captcha_failed` 와 토큰 없음은 한국어 안내(`src/components/auth/captcha.ts`).
  - 로컬은 끈 채로 둔다(`supabase/config.toml` 의 `[auth.captcha]` 주석 — 켜면 `supabase stop/start` 가 필요하고 토큰 없는 스크립트 로그인이 막힌다). 위젯만 보려면 `.env.local` 에 테스트 사이트 키 `1x00000000000000000000AA`(항상 통과) / `2x00000000000000000000AB`(항상 실패).
- [ ] **미확인 사용자 정리**: `/signup` 코드 발송이 주소마다 계정 행을 만든다. 주기적으로(예: 주 1회) `email_confirmed_at is null and created_at < now() - interval '1 day'` 인 auth 사용자를 관리자 API 로 지운다(앱 데이터가 없는 행만 — FK NO ACTION 이라 데이터가 있으면 삭제가 막힌다).
- [ ] `scripts/apply-hosted-auth.sh` 가 찍는 rate limit(`rate_limit_otp`·`rate_limit_verify`·`rate_limit_token_refresh`·`rate_limit_email_sent`)·재인증 값 확인.
- 남는 위험(문서화): 재설정 화면은 없는 주소도 "가입된 주소라면 코드가 갔어요" 로 똑같이 코드 단계로 가지만, GoTrue `/otp` 를 anon 키로 직접 부르면 없는 주소(422 `otp_disabled`)와 있는 주소(200)가 구분된다. 로그인도 GoTrue 가 있는 계정만 bcrypt 비교를 해 응답 시간 차이가 난다. 둘 다 GoTrue 고유 동작 — 막으려면 서버 라우트로 감싸야 한다(CAPTCHA 가 대량 열거는 늦춘다). 비밀번호 변경 재인증의 24시간 예외도 위 참고.

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

1. Vercel 에 `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY` 등록 전에는 `vercel --prod` 금지. 없으면 proxy 가 모든 요청을 비로그인으로 통과시키고(500 은 안 남), 등록하면 비로그인 사용자의 보호 라우트(`/my-study`·`/schedule`·`/me`·`/rooms/new`)를 `/login` 으로 보내는데 `/login` 은 plan 05 머지 전에는 404 — plan 05 머지 전에는 프로덕션 배포 자체를 하지 않는다.
2. Vercel 프로젝트 Node 버전은 22 이상.
3. `supabase db push --include-seed`·`supabase db reset --linked` 절대 금지 — seed 는 로컬 전용(`app.today` 고정, 비밀번호 없는 29명).
