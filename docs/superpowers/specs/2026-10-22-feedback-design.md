# 의견 보내기(버그 신고·제안·문의) — 설계

2026-10-22 · 마이그레이션 0044 · 요청: 헤더 우측, 알림 벨 왼쪽에 고객 접수 버튼

## 결정 (권장안 = 구현안)

| # | 결정 | 선택지 | 권장(구현) |
|---|---|---|---|
| D1 | 누가 보내나 | (a) 로그인 사용자만 (b) 익명도 + 연락 이메일 (c) 익명은 Turnstile 통과 시만 | **(a)** — 벨·아바타와 같이 로그인했을 때만 버튼을 그린다. RPC 에 CAPTCHA 가 없어 익명 개방은 스팸 통로가 된다. 닉네임 전(온보딩 전) 계정도 보낼 수 있다(`require_user` 대신 `auth.uid()` 만 확인 — 온보딩 화면 버그도 받는다). 익명 접수는 (c) 로 나중에 |
| D2 | 버튼 자리 | (a) 헤더 벨 왼쪽, 모든 폭 (b) ≤640 은 아바타 메뉴 안으로 | **(a)** — 390 폭 첫 줄 = 로고(≈124) + 빈칸 + 44×3 + 간격 12×3 ≈ 292px < 358px, 줄바꿈 없음. 벨과 같은 44px 테두리 버튼, 이름 「의견 보내기」(title 툴팁 동일) |
| D3 | 양식 | 종류 + 내용 + (첨부) + (연락처) | 종류 4개 `BUG 버그 신고 · IDEA 제안 · QUESTION 문의 · OTHER 기타`(기본 BUG), 내용 **5~2,000자**(앞뒤 공백 뺀 길이, 카운터 표시). 연락처 칸 없음 — 로그인 계정 이메일로 답한다(D1) |
| D4 | 스크린샷 첨부 | (a) 지금 (b) 나중 | **(b) 나중** — 기존 업로드(file_register·node_file_register)는 과제·항목에 묶인 버킷 경로·정책이라 재사용이 싸지 않다. 지금은 「화면 캡처가 필요하면 내용에 적어 주세요」 안내만 |
| D5 | 자동 첨부 정보 | — | `path`(pathname + 허용 쿼리 tab·item·task·mode 만 — `?invite=`·`/invite/{토큰}` 같은 비밀은 남기지 않는다. `/invite/*` 는 `/invite/…` 로 가림), `room`(/rooms/{slug}·/my-study/{slug} 의 slug), `userAgent`, `viewport`(가로×세로), `appVersion`(빌드 커밋 `VERCEL_GIT_COMMIT_SHA` 앞 7자 → `NEXT_PUBLIC_APP_COMMIT`, 없으면 `dev`). **사용자 id·이메일은 서버가 auth.uid() 로 붙인다**(클라이언트 값 불신). 양식 아래 「함께 보내는 정보」 접힘 영역에 그대로 보여 준다 |
| D6 | 저장 | — | 표 `public.feedback`(id · user_id → profiles on delete set null · kind · message · context jsonb · status `NEW/SEEN/DONE` · created_at). RLS on, 정책 없음, anon·authenticated 표 권한 전부 회수. RPC `feedback_submit(p_kind text, p_message text, p_context jsonb) returns jsonb {id, createdAt}` — security definer, `search_path = ''`, 오류는 `public.fail`. context 는 객체·허용 키만·값은 문자열 ≤500자(viewport ≤20) |
| D7 | 레이트 리밋 | 사용자당 / IP | **사용자당 10분 5건 · 하루 20건**(advisory 잠금, 0041 comment_rate_check 와 같은 모양) → `RATE_LIMITED` + `retryAfterSec`. IP 는 PostgREST RPC 에서 신뢰할 값이 없어 쓰지 않는다(D1 로 익명이 없으니 계정 단위로 충분) |
| D8 | 내 접수 목록 | (a) 본인 목록 RPC (b) 없음 | **(b)** — 답장 경로가 아직 없어 목록이 줄 정보가 없다. 답장 기능을 만들 때 함께 |
| D9 | 운영자가 읽는 법 | (a) Supabase 대시보드(Table Editor·SQL, service role) (b) 앱 안 관리자 화면 + `FEEDBACK_ADMIN_EMAILS` 허용 목록 | **(a)** — 앱에 관리자 역할이 없다(마이그레이션·src 에 admin 개념 없음, master 계정은 테스트용). (b) 는 서버 라우트가 service role 로 읽고 이메일 목록으로 막는 새 권한 표면이라, 접수량이 생긴 뒤 별도 스펙으로. 아래 SQL 참고. 처리 상태는 대시보드에서 `status` 를 바꾼다 |
| D10 | 운영자 알림 | 메일 / Slack 웹훅 / 없음 | **없음(나중)** — mail_outbox 에 발송기가 없다. 발송기를 붙이면 feedback_submit 에서 outbox 한 줄을 넣는 식으로 |
| D11 | MCP 노출 | — | **안 함** — api_invoke 허용 목록 그대로 |
| D12 | 탈퇴 사용자 | cascade / set null | **set null** — 신고 내용은 남긴다(개인 식별 정보는 context 에 없음) |

## UI

- 헤더(AppHeader) 로그인 분기에서 `{bell}` 바로 앞. 아이콘 = 말풍선, 44×44 `rounded-[12px] border border-line bg-surface`(벨과 같음)
- 누르면 모달(ConfirmDialog 모양: 어두운 배경 · 18px 라운드 카드 · useFocusTrap · Esc/바깥 클릭 닫기 · 보내는 중엔 안 닫힘 · 닫히면 버튼으로 포커스)
- 종류 = 라디오 칩 4개(radiogroup), 내용 textarea(카운터 `n/2,000`), 「함께 보내는 정보」 `<details>`
- 보내기 성공 → 모달 닫고 토스트 「보내 주셔서 고마워요 · 꼼꼼히 살펴볼게요」. 실패 → 모달 안 오류 문구(서버 문구 우선), 입력 유지
- 오류 문구(해요체): `RATE_LIMITED` 「잠시 후 다시 보내 주세요」(서버 문구), `VALIDATION_FAILED` 「내용은 5~2,000자예요」, `AUTH_REQUIRED` 「로그인이 필요해요」

## 운영자 조회 (D9)

Supabase 대시보드 → SQL Editor:

```sql
select f.id, f.created_at at time zone 'Asia/Seoul' as kst, f.kind, f.status, p.nickname, u.email,
       f.message, f.context
from public.feedback f
left join public.profiles p on p.id = f.user_id
left join auth.users u on u.id = f.user_id
order by f.id desc limit 50;

update public.feedback set status = 'DONE' where id = 123;
```

## 배포

1. hosted DB 에 0044 적용
2. (선택) Vercel 은 `VERCEL_GIT_COMMIT_SHA` 를 빌드에 자동으로 넣는다 — 추가 env 없음
