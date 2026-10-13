# 공통(Cross-cutting) — 백엔드 요구 분석

> 특정 화면에 속하지 않지만 `docs/claude-design-prompt.md` 가 요구하는 백엔드 기능.
> 대상: 인증 / 사용자·프로필 / 알림 / 스케줄 작업 / 파일 업로드 / 태그 / 공통 API 규약.
> 템플릿의 §1·§6 은 화면 대신 **"프론트 공용 요구"** 기준으로 적는다.
> 스택 전제: Spring Boot 3 · Java 21 · PostgreSQL · 프론트는 Vercel(Next.js 16) → 별도 API(`NEXT_PUBLIC_API_URL`, 기본 `:8080`).

---

## 1. 프론트 공용 요구 (Read model)

화면 코드가 **전역적으로** 기대하는 데이터. 현재 목업 출처는 `src/lib/routes.ts` 의 `ME`, `TODAY` 와 `AppHeader` 의 `unread` prop.

| 필드 | 타입 | 어디서 오는가 | 비고(목업 값) |
|---|---|---|---|
| `me.id` | string | `users.id` | 목업엔 없음(항상 "철수") |
| `me.nickname` | string(2~16) | `users.nickname` | `ME.name = "철수"` |
| `me.initial` | string(1) | 계산: 닉네임 첫 글자 | `ME.initial = "철"` |
| `me.tone` | `"mint"\|"blue"\|"peach"\|"lav"\|"amber"\|"slate"` | `users.avatar_tone` (가입 시 결정, 서버 저장) | `ME.tone = "blue"`, 목업은 `NAME_TONE[name]` 하드코딩 |
| `me.email` | string | `users.email` | 읽기 전용 (§4.13) |
| `me.onboarded` | boolean | `users.nickname IS NOT NULL` | 미완료면 `/onboarding` 강제 |
| `me.optionalMailEnabled` | boolean | `users.optional_mail_enabled` | §4.13 토글, 기본 `true` |
| `unreadCount` | int | `COUNT(notifications WHERE user_id=me AND read_at IS NULL)` | `AppHeader unread=3` 하드코딩 |
| `today` | `YYYY-MM-DD` | **서버의 KST 오늘** (`/api/v1/meta` 또는 각 응답 헤더) | `TODAY = "2026-10-12"` 하드코딩 |
| `notifications[]` | 아래 §3.3 페이로드 | `notifications` | 드롭다운 전용, 화면 미구현 |
| `tagDictionary[]` | `{slug,label,tone}` | `tags` | 자동완성·필터 칩 |

- 프론트의 모든 D-day/상태 계산이 `TODAY` 에 의존하므로, 실전환 시 **"오늘"은 클라이언트 시계가 아니라 서버가 KST 로 내려준 값**을 쓰는 걸 권장한다. Vercel 엣지/브라우저 시간대와 백엔드 스케줄러 시간대를 일치시키기 위함.
- `tone` 은 프론트가 이름→색 매핑을 들고 있지만, 실서비스에선 닉네임이 중복 불가·변경 가능이므로 **서버가 사용자별 tone 을 저장**하고 내려준다(§2.2 참조).

---

## 2. 사용자 액션 → 백엔드 연산 (Write model)

### 2.1 인증 (이메일 OTP)

#### 2.1.1 흐름 요약
```
/login  이메일 입력 ─▶ POST /auth/otp/request ─▶ 메일 발송(6자리)
        OTP 입력   ─▶ POST /auth/otp/verify  ─▶ 세션 발급
                                              ├─ nickname 없음 → /onboarding
                                              └─ returnTo 있음 → 그 URL, 없으면 /rooms
```

#### 2.1.2 OTP 요청 `POST /auth/otp/request`
| 항목 | 내용 |
|---|---|
| 트리거 UI | "인증 코드 받기" 버튼, "재전송" 링크 |
| 선행 조건 | 없음(비로그인). 이미 로그인 상태면 302 가 아닌 200 + `alreadyAuthenticated` |
| 입력 | `{ email }` — RFC 형식, 소문자 정규화, 길이 ≤ 254 |
| 검증·제한 | 재전송 타이머 **60초**(같은 이메일), 이메일당 **10분에 5회**, IP당 **10분에 20회** |
| 코드 | 6자리 숫자, `SecureRandom`, **유효 10분**, DB엔 `sha256(code + salt)` 저장, 평문 저장 금지 |
| 부수효과 | 이전 미사용 OTP 는 `consumed_at = now()` 로 무효화(한 이메일에 유효 코드 1개). 메일 발송은 §3.6 `MailSender` 인터페이스 경유 |
| 응답 | `{ expiresInSec: 600, resendAfterSec: 60 }` — **이메일 존재 여부를 노출하지 않음**(가입/미가입 동일 응답) |
| 실패 | `AUTH_OTP_RATE_LIMITED`(429, `retryAfterSec` 포함) · `VALIDATION_FAILED`(400) |

#### 2.1.3 OTP 검증 `POST /auth/otp/verify`
| 항목 | 내용 |
|---|---|
| 입력 | `{ email, code, returnTo? }` |
| 검증 | 최신 유효 OTP 1건과 비교. **시도 5회 초과 시 해당 코드 폐기**(`attempts` 컬럼 증가, 비교는 상수 시간) |
| 성공 시 | `users` upsert(없으면 생성, `nickname=NULL`) → 세션 발급(§2.1.5) → `{ user: Me, needsOnboarding, returnTo }` |
| `returnTo` | 서버에서 **상대 경로 + 화이트리스트 프리픽스**(`/rooms/`, `/invite/`, `/my-study`, `/schedule`)만 통과, 그 외는 `/rooms` 로 치환(오픈 리다이렉트 방지) |
| 실패 | `AUTH_OTP_INVALID`(400) · `AUTH_OTP_EXPIRED`(400) · `AUTH_OTP_TOO_MANY_ATTEMPTS`(429) |

#### 2.1.4 로그아웃 `POST /auth/logout`
refresh 토큰 revoke + 쿠키 삭제. 모든 기기 로그아웃은 2단계.

#### 2.1.5 세션 전략 (Vercel 프론트 ↔ 별도 API)
**결정 필요.** 후보 비교:

| 전략 | 장점 | 단점 | 비고 |
|---|---|---|---|
| **A. HttpOnly 쿠키 + 같은 사이트 (추천)** | XSS 로 토큰 탈취 불가, 프론트 코드 단순(fetch `credentials:"include"`) | API 가 **프론트와 같은 등록 도메인**이어야 `SameSite=Lax` 로 동작 (예: `sgtudy.vercel.app` ↔ `api.sgtudy.xyz` 는 cross-site). 프리뷰 URL 마다 CORS 허용 필요 | 커스텀 도메인 `app.sgtudy.xyz` + `api.sgtudy.xyz` 로 묶으면 가장 깔끔 |
| B. Next.js Route Handler 프록시(`/api/*` → `:8080`) | 브라우저 입장에선 same-origin → 쿠키 문제 없음, CORS 불필요, API URL 비노출 | Vercel 함수 경유로 지연·비용, 서버 컴포넌트에서 쿠키 전달 코드 필요 | 커스텀 도메인 없을 때 현실적 대안 |
| C. Bearer JWT (메모리) + refresh 쿠키 | 도메인 제약 없음 | access 토큰을 JS 가 들고 있어 XSS 노출, 새로고침마다 refresh 호출, SSR 에서 불편 | 모바일 앱 추가 시 필요 |

- 제안 기본값: **A**, 도메인 미확보 기간엔 **B** 로 동일 쿠키 규격 유지. 쿠키 규격: `sg_at`(access, JWT, 15분) + `sg_rt`(refresh, opaque, 30일, `Path=/auth`, **회전식**·재사용 감지 시 전체 revoke). 둘 다 `HttpOnly; Secure; SameSite=Lax`.
- JWT 클레임: `sub=userId, nick, iat, exp, jti`. 롤/권한은 넣지 않는다(방별 역할이라 토큰에 담을 수 없음).
- CORS: `Access-Control-Allow-Origin` 을 **환경변수 화이트리스트**(`https://sgtudy.vercel.app`, `https://*-picpal.vercel.app` 패턴, `http://localhost:3000`), `Allow-Credentials: true`, 허용 헤더 `Content-Type, X-Requested-With`. 와일드카드 `*` 금지(credentials 와 양립 불가).
- CSRF: 쿠키 방식이므로 상태 변경 요청은 `SameSite=Lax` + **Origin 헤더 검증** 으로 방어. 별도 토큰 불필요(폼 POST 미사용).
- 세션 갱신 `POST /auth/refresh`: refresh 쿠키로 새 access/refresh 쌍 발급. 프론트는 401 수신 시 1회 재시도.

#### 2.1.6 비로그인 읽기 허용 범위
| 리소스 | 비로그인 | 비고 |
|---|---|---|
| `GET /rooms`(공개 방 목록·검색·태그 필터) | 허용 | `visibility=PUBLIC` 만, 비공개 방은 목록에 절대 미노출 |
| `GET /rooms/{id}`(개요·커리큘럼 트리·참가자 목록·진척률) | 공개 방만 허용 | 비공개 방 → `ROOM_FORBIDDEN`(403, 존재 여부 비노출 위해 404 와 동일 본문 고려) |
| 보드·캘린더·간트 집계 | 공개 방만 허용 | 사람별 상태 아이콘까지 공개(설계 §2.1 "읽기 전용") |
| 과제 상세의 **제출물 본문·첨부** | **불허** | §2.3 "비로그인·외부 비공개" → 같은 방 **참가자만** |
| `GET /invite/{token}` 미리보기 | 허용 | 제목·소개·기간·인원·그룹장만 |
| 참가/신청 등 모든 POST | 불허 → `AUTH_REQUIRED`(401) | 프론트는 `returnTo` 붙여 `/login` 이동 |
| `/me`, 알림, 내 스터디, 내 일정 | 불허 | |

#### 2.1.7 온보딩 닉네임
| 항목 | 내용 |
|---|---|
| 트리거 UI | `/onboarding` (최초 1회), `/me` 닉네임 변경 |
| 선행 조건 | 로그인. `nickname IS NULL` 인 사용자는 **온보딩 외 모든 API 가 `ONBOARDING_REQUIRED`(403)** 반환 — 프론트 미들웨어도 `/onboarding` 으로 보냄 |
| 입력 | `{ nickname }` 2~16자, 앞뒤 공백 trim, 한글·영문·숫자·`_`·`.`·공백(연속 불가) 허용, 제어문자·이모지 불허 |
| 중복 체크 | `GET /users/nickname-check?value=` → `{ available }`. **대소문자·유니코드 NFC 정규화 후 비교**(`nickname_normalized` UNIQUE 인덱스). 프론트는 300ms 디바운스 |
| 금칙어 | `관리자`, `admin`, `sseukstudy` 등 소규모 블랙리스트 → `NICKNAME_RESERVED` |
| 부수효과 | 최초 설정 시 `avatar_tone` 결정(§2.2.2) |
| 실패 | `NICKNAME_TAKEN`(409) · `NICKNAME_INVALID`(400) · `NICKNAME_RESERVED`(400) |

#### 2.1.8 초대 토큰
| 항목 | 내용 |
|---|---|
| 생성 | 방 생성 시 자동 1개. `POST /rooms/{id}/invites` (그룹장) 로 재발급 → 기존 토큰 `revoked_at` 처리(**한 방에 활성 토큰 1개**) |
| 형식 | 22자 URL-safe base64(128bit random). URL: `https://{front}/invite/{token}`. 공개 방도 초대 링크로 들어올 수 있음(동일 처리) |
| 만료 | **결정 필요.** 제안: 기본 만료 없음, 방이 `ENDED/ARCHIVED` 가 되면 무효. 그룹장이 "링크 재발급"으로 수동 무효화 |
| 미리보기 `GET /invite/{token}` | 비로그인 허용. 응답: `{ room: {id, title, summary, startDate, endDate, memberCount, maxMembers, status, visibility, joinMode, tags}, leader: {nickname, tone}, myJoinState }`. 비공개 방이라도 **이 경로로만** 정보 공개 |
| 참가 `POST /invite/{token}/join` | 로그인 필요. 방 참가 규칙(모집중·정원·승인제)은 방 참가 API 와 동일. 비공개 방 진입 권한 = **"유효한 토큰을 아는 것"**. 참가/신청 후엔 토큰 없이도 `/rooms/{id}` 접근 가능 |
| 비로그인 복귀 | 프론트가 `/login?returnTo=/invite/{token}` 으로 보내고 로그인 후 §2.1.3 `returnTo` 로 복귀 |
| 실패 | `INVITE_NOT_FOUND`(404) · `INVITE_REVOKED`(410) · `ROOM_NOT_RECRUITING`(409) · `ROOM_FULL`(409) |

### 2.2 사용자 / 프로필

#### 2.2.1 `PATCH /me`
| 항목 | 내용 |
|---|---|
| 입력 | `{ nickname?, optionalMailEnabled? }` |
| 닉네임 | §2.1.7 과 동일 규칙. 변경 시 알림 페이로드에 박힌 과거 문구는 **갱신하지 않음**(스냅샷) — 프론트가 알림 목록에서 닉네임을 보여주려면 `actor.nickname` 을 조인해 내려줄지 결정(§3.3) |
| 이메일 | 읽기 전용. 변경 기능 없음(OTP 아이덴티티 자체) |
| 옵션 메일 끄기 | `optional_mail_enabled=false` → §3.5 옵션 알림의 **메일 채널만** 끔. 인앱 알림은 계속 생성. 기본(잠금) 3종 메일은 항상 발송 |

#### 2.2.2 아바타
- 이미지 업로드 없음(설계 §4.13 "아바타"는 이니셜 아바타). `initial` 은 닉네임 첫 글자(grapheme 단위, 서버에서 계산해 내려줌).
- `avatar_tone` 은 **온보딩 시 서버가 6색 중 하나를 결정**해 저장. 제안: `hash(userId) % 6` (닉네임 변경에도 색 유지 → 사람 식별 일관성). 프론트 `NAME_TONE`/`toneOf()` 는 목업 전용이므로 API 전환 시 `member.tone` 필드로 대체.
- 2단계 여지: `PATCH /me { avatarTone }` 로 사용자 선택 허용.

### 2.3 알림 (인앱)

#### 2.3.1 읽기·읽음 처리
| API | 설명 | 권한 |
|---|---|---|
| `GET /notifications?cursor=&limit=20` | 최신순, 커서 페이징. 드롭다운은 20개 | 본인 |
| `GET /notifications/unread-count` | `{ count }` — 헤더 배지. 폴링 60초 or 페이지 전환 시 | 본인 |
| `POST /notifications/{id}/read` | `read_at=now()` (멱등) | 본인 소유만, 아니면 404 |
| `POST /notifications/read-all` | `UPDATE … WHERE user_id=me AND read_at IS NULL` | 본인 |

- 클릭 시 "대상 이동 + 읽음": 프론트가 `link` 로 이동하면서 `POST …/read` 를 **fire-and-forget**. 서버는 read 실패해도 이동엔 영향 없게.
- 실시간 푸시(SSE/WebSocket)는 1단계 미포함. 배지는 폴링.

#### 2.3.2 이벤트 종류 → 수신자 규칙
설계 §2.5 + §4.11 을 합친 전체 목록. `kind` 는 enum 으로 DB 저장.

| `kind` | 발생 시점 | 수신자 | 기본/옵션(§4.11) | 생성 주체 |
|---|---|---|---|---|
| `ROUND_STARTED` | 2단계 노드(회차) `startDate` 00:00 KST | 활성 참가자 전원(그룹장 포함) | **기본·잠금** | 스케줄러 |
| `TASK_ALL_SUBMITTED` | 말단 과제의 담당자 전원 제출 완료 순간 | 그룹장 | **기본·잠금** (즉시 / 일일 요약 선택) | 제출 트랜잭션 |
| `JOIN_REQUESTED` | 승인제 방에 신청 | 그룹장 | 기본(그룹장 운영 알림) | 참가 API |
| `JOIN_APPROVED` | 그룹장 승인 | 신청자 | **기본·잠금** | 승인 API |
| `JOIN_REJECTED` | 그룹장 거절 | 신청자 | 기본 | 거절 API |
| `JOIN_EXPIRED` | 시작일 자동 만료 | 신청자 | 기본 | 스케줄러 |
| `DEADLINE_REMINDER` | 마감 D-3 / D-1 09:00 KST, **미제출 담당자만** | 해당 과제 담당자 중 미제출자 | 옵션(1일 전/3일 전 각각 토글) | 스케줄러 |
| `TASK_ASSIGNED` | 지정 과제 담당자 추가 / 이탈 처리 재지정 | 새 담당자 | 옵션 | 커리큘럼 저장·이탈 API |
| `TASK_UNASSIGNED` | 담당자에서 제외 | 제외된 사람(활성인 경우만) | 옵션(TASK_ASSIGNED 토글 공유) | 커리큘럼 저장 |
| `SCHEDULE_CHANGED` | 노드 기간 변경 저장 (방 기간 변경 포함) | 활성 참가자 전원 | 옵션 | 커리큘럼·방정보 저장 |
| `ROOM_STARTED` | 자동/조기 시작으로 `ACTIVE` 전환 | 활성 참가자 전원 | 옵션 | 스케줄러·"지금 시작" API |
| `ROOM_ENDED` | 종료일 다음날 00:00 KST `ENDED` 전환 | 활성 참가자 전원 | 옵션 | 스케줄러 |
| `MEMBER_DEACTIVATED` | 그룹장이 이탈 처리 | 이탈 당사자 | 기본 | 이탈 API |

- "활성 참가자" = `room_members.status='ACTIVE'`. 이탈자(`INACTIVE`)·대기자(`PENDING`)는 어떤 방 알림도 받지 않음(단, 자신의 신청 결과는 받음).
- 본인이 일으킨 이벤트는 본인에게 보내지 않는다(그룹장이 지정 과제에 자기 자신을 배정해도 `TASK_ASSIGNED` 생략).
- **집약 규칙**: 한 번의 커리큘럼 저장으로 같은 사람에게 `SCHEDULE_CHANGED` 가 N건 생기면 **방·kind·수신자·저장 트랜잭션 단위로 1건**으로 합침(`dedupe_key` 참조).

#### 2.3.3 페이로드 (드롭다운 1행)
```json
{
  "id": "01J9...",
  "kind": "DEADLINE_REMINDER",
  "icon": "clock",                 // kind → 아이콘 키 매핑, 프론트가 SVG 선택
  "title": "VPC 실습 마감 1일 전이에요",
  "body": null,                    // 선택, 2줄 clamp
  "room": { "id": "aws", "title": "AWS SAA 자격증 3개월 완주" },
  "link": "/my-study/aws?task=42", // 프론트 라우트. routes.ts 에 대응 라우트가 없으면 §7 참조
  "actor": { "nickname": "민수", "tone": "mint" },  // 사람 액션일 때만
  "createdAt": "2026-10-12T00:00:00Z",
  "readAt": null
}
```
- `title` 은 **생성 시점에 서버가 한국어 문구로 렌더링해 저장**(템플릿 `kind` 별, i18n 1단계 미고려). 방 제목·과제 제목은 스냅샷. 대신 `room.id`, `task_id` 등 참조 ID 를 별도 컬럼으로 두어 링크·필터에 사용.
- 상대 시간("3시간 전")은 프론트가 `createdAt` 으로 계산.
- 삭제된 방/과제의 알림: 링크 클릭 시 404 → 프론트가 토스트. 서버는 알림을 지우지 않음.

#### 2.3.4 룸별 알림 설정 (§4.11, 그룹장)
```
room_notification_settings (room_id PK)
  reminder_d1          bool  default true   -- 옵션
  reminder_d3          bool  default true   -- 옵션
  task_assigned        bool  default true   -- 옵션
  schedule_changed     bool  default true   -- 옵션
  room_start_end       bool  default true   -- 옵션
  completion_mode      enum('DAILY_DIGEST','IMMEDIATE') default 'DAILY_DIGEST'
```
- 기본 3종(회차 시작 / 과제 완료 요약 / 참가 승인)은 **컬럼 자체를 두지 않는다**(끌 수 없음, 프론트가 잠금 아이콘으로 표시).
- `completion_mode=DAILY_DIGEST` 면 `TASK_ALL_SUBMITTED` 를 즉시 만들지 않고 **매일 09:00 KST 에 하루치를 묶어 1건**(`TASK_COMPLETION_DIGEST`, title "어제 3개 과제가 전원 제출됐어요")으로 생성. 옵션 설정은 **방 단위이며 그 방의 모든 참가자에게 적용**(개인별 세분 설정은 2단계).
- `GET/PUT /rooms/{id}/notification-settings` — 그룹장만. PUT 은 전체 교체.

#### 2.3.5 생성 파이프라인
```
도메인 이벤트(트랜잭션 내 @TransactionalEventListener AFTER_COMMIT)
  → NotificationService.publish(kind, roomId, recipients, payload, dedupeKey)
     ├─ room_notification_settings 로 옵션 필터
     ├─ dedupe_key UNIQUE 로 중복 삽입 무시 (ON CONFLICT DO NOTHING)
     ├─ notifications INSERT (인앱, 항상)
     └─ MailSender.enqueue(...)  ← 2단계. 1단계는 No-op 구현
```
- `dedupe_key` 예: `DEADLINE_REMINDER:task=42:user=7:d=1`, `ROUND_STARTED:node=11:user=7`. 스케줄러 재실행 시 이 키가 멱등성을 보장(§3.4).

#### 2.3.6 메일 인터페이스 (2단계, 지금은 시그니처만)
```java
public interface MailSender {
    void sendOtp(String to, String code, Duration ttl);           // 1단계 필수 (OTP)
    void enqueueNotification(long userId, NotificationKind kind,
                             Map<String,Object> model);           // 2단계. 1단계 No-op
}
```
- OTP 메일만 1단계에서 실제 구현(SMTP/SES). 알림 메일은 `optional_mail_enabled` 와 룸 설정을 **보낼 때** 평가하도록 설계해 두고 구현은 비움.
- 발송 레코드(`mail_outbox`: id, to, template, model_json, status, attempts, sent_at)를 1단계에 미리 만들어 두면 2단계에서 워커만 붙이면 된다. **Outbox 패턴** 권장.

### 2.4 스케줄 작업
| 작업 | 실행 시각(KST) | 쿼리 조건 | 상태 변화·부수효과 | 멱등성 |
|---|---|---|---|---|
| **방 자동 시작** | 매일 00:00 (+ 5분 간격 보정 실행) | `status='RECRUIT' AND start_date <= today_kst` | `status='ACTIVE'`, `started_at=now()`, `ROOM_STARTED` 알림. 말단 과제 0개면 전환하지 않고 그룹장에게 `ROOM_START_BLOCKED` 알림(§7) | `UPDATE … WHERE status='RECRUIT'` 조건부 갱신 → 두 번 돌아도 0 rows |
| **대기 신청 자동 만료** | 방 자동 시작과 **같은 트랜잭션** | 그 방의 `room_members.status='PENDING'` | `status='EXPIRED'`, `JOIN_EXPIRED` 알림 | 상동 |
| **방 자동 종료** | 매일 00:00 | `status='ACTIVE' AND end_date < today_kst` (종료일 **다음날**) | `status='ENDED'`, `ended_at`, `ROOM_ENDED` 알림 | 조건부 갱신 |
| **회차 시작 알림** | 매일 00:00 | `goal_nodes.depth=2 AND start_date = today_kst AND room.status='ACTIVE'` | `ROUND_STARTED` | `dedupe_key` |
| **마감 리마인더** | 매일 09:00 | leaf `end_date = today_kst + 1` (D-1) / `+ 3` (D-3), 룸 설정 ON, 담당자 중 미제출 | `DEADLINE_REMINDER` | `dedupe_key`(task·user·d) |
| **일일 요약** | 매일 09:00 | `completion_mode='DAILY_DIGEST'` 방의 전날 전원 제출 과제 | `TASK_COMPLETION_DIGEST` 1건/방/그룹장 | `dedupe_key`(room·date) |
| **OTP·토큰 정리** | 매일 04:00 | `expires_at < now()-7d` | 삭제 | 자연 멱등 |

시간대 처리 원칙
- 모든 `*_date` 컬럼은 **`DATE` 타입, KST 달력 날짜**. 비교 기준 `today_kst = (now() AT TIME ZONE 'Asia/Seoul')::date`. 타임스탬프 컬럼은 `TIMESTAMPTZ`(UTC 저장).
- JVM `-Duser.timezone=Asia/Seoul` 에 의존하지 말고 코드에서 `ZoneId.of("Asia/Seoul")` 명시. 스케줄은 `@Scheduled(cron="0 0 0 * * *", zone="Asia/Seoul")`.
- 인스턴스가 2개 이상이면 **ShedLock**(`shedlock` 테이블)으로 단일 실행. 1단계 단일 인스턴스여도 미리 넣어두는 비용이 작다.
- 00:00 작업이 실패/누락돼도 **조건이 `<=`/`<` 이므로 다음 실행이 밀린 전환을 따라잡는다**. 보정 실행(5분 간격)을 두면 조기 시작 직후 상태 불일치 창이 짧아진다.
- "지각" 판정은 스케줄러가 아니라 제출 시점에 `submitted_at > end_date 23:59:59 KST` 로 계산해 `is_late` 고정 저장(§2.3 "최초 제출 시점 기준 고정").

### 2.5 파일 업로드 (과제 제출 첨부)
| 항목 | 내용 |
|---|---|
| 제한 | 파일당 **10MB**, 제출당 **5개**, 허용 MIME: `image/png, image/jpeg, image/gif, image/webp, application/pdf, application/zip, text/plain, text/markdown`. 확장자·MIME·매직바이트 3중 검사 |
| 저장소 | **결정 필요.** 제안: **S3 호환(AWS S3 / Cloudflare R2) + presigned URL 직접 업로드**. 서버 경유 방식은 Spring 메모리·대역폭을 먹고 Vercel→API→S3 2홉이 된다 |
| 흐름 | ① `POST /rooms/{id}/tasks/{taskId}/attachments/presign { fileName, size, contentType }` → 검증(개수·크기·MIME·담당자) → `files` 행 `status=PENDING` 생성 → `{ fileId, uploadUrl, headers }` (만료 5분, `Content-Length`·`Content-Type` 조건 고정) ② 브라우저가 PUT ③ `POST …/attachments/{fileId}/complete` → 서버가 `HEAD` 로 존재·크기 확인 → `status=READY` ④ 제출 저장 시 `fileIds[]` 로 연결 |
| 객체 키 | `rooms/{roomId}/tasks/{taskId}/{userId}/{fileId}` — 원본 파일명은 DB 에만, 키에 넣지 않음(경로 조작·인코딩 문제 회피) |
| 다운로드 | 버킷은 **private**. `GET /files/{fileId}/url` → 같은 방 `ACTIVE`(또는 그룹장) 참가자 검증 후 **presigned GET URL(5분)** 반환. 이탈자도 열람 가능하게 할지 §7 |
| 이미지 미리보기 | 1단계는 presigned GET 으로 `<img>` 직접 표시. 썸네일 생성은 2단계 |
| 정리 | `PENDING` 이 1시간 넘은 행과 객체 삭제(일일 배치). 제출에서 첨부 제거 시 soft delete 후 배치 삭제 |
| 실패 | `FILE_TOO_LARGE`(413) · `FILE_TYPE_NOT_ALLOWED`(415) · `FILE_LIMIT_EXCEEDED`(409) · `FILE_NOT_READY`(409) |
| 로컬 개발 | MinIO 또는 `LocalFileStorage` 구현체(서버 경유)로 `StorageClient` 인터페이스 교체 |

### 2.6 태그
| 항목 | 내용 |
|---|---|
| 사전 `tags` | `slug`(PK, 예 `aws`), `label`("AWS"), `tone`(6색), `aliases[]`(검색·자동완성용, 예 "아마존"), `usage_count`. 초기 시드: 목업 태그 전부(AWS·클라우드·자격증·영어·토익·Spring·백엔드·Java·알고리즘·코딩테스트·정보처리기사·CS·면접·React·프론트엔드·Docker·Kubernetes·SQL·데이터) |
| 방-태그 | `room_tags(room_id, tag_slug, source enum('AUTO','MANUAL'), created_at)`. 프론트 `RoomTag.auto` ↔ `source='AUTO'` |
| 자동 선택 트리거 | 커리큘럼 저장 트랜잭션 커밋 후 **비동기**(`@Async` / 이벤트). 응답은 바로 돌려주고, 프론트는 "저장 후 태그 자동 갱신 토스트"를 위해 `GET /rooms/{id}/tags` 를 재조회하거나 응답에 `tagJobId` 포함 |
| 인터페이스 | `TagSuggester.suggest(RoomContext ctx, List<Tag> dictionary) → List<String> slugs` (최대 5개). 구현체: `LlmTagSuggester`(1순위), `KeywordTagSuggester`(fallback: 제목·노드 제목에서 `label/aliases` 부분 일치), `NoopTagSuggester` |
| LLM 호출 | 입력은 방 제목·소개·노드 제목 목록(설명 마크다운은 2천자로 절단) + **사전 slug 목록**. 출력은 **사전에 있는 slug 만** 허용하도록 응답 검증(없는 slug 는 버림). 타임아웃 8초, 재시도 1회, 실패 시 keyword fallback. 호출 모델·키는 설정값(`sg.tag.provider=llm|keyword|none`) |
| 병합 규칙 | 자동 결과는 **`MANUAL` 태그를 건드리지 않음**. 기존 `AUTO` 태그는 전부 교체. 그룹장이 삭제한 자동 태그가 다음 저장에서 다시 붙는 문제 → `room_tag_suppressions(room_id, tag_slug)` 에 기록해 재부착 방지 |
| 수동 추가 | `PUT /rooms/{id}/tags { slugs[], freeLabels[] }` — 자유 입력은 사전에 없으면 `tags` 에 **새 항목 생성**(`slug = slugify(label)`, tone 은 해시). 방당 최대 **8개**, 그룹장만 |
| 필터 | `GET /rooms?tag=aws` — `room_tags` 조인. 태그 칩 클릭 → 이 쿼리 |
| 실패 | `TAG_LIMIT_EXCEEDED`(409) · `TAG_LABEL_INVALID`(400, 1~20자) |

---

## 3. 파생 값 계산 규칙

| 값 | 규칙 | 예 |
|---|---|---|
| `unreadCount` | `COUNT(*) WHERE user_id=? AND read_at IS NULL`. 99 초과면 프론트 "99+" | 목업 3 |
| `initial` | 닉네임의 첫 grapheme cluster. 영문은 대문자화 | "철수"→"철", "jiho"→"J" |
| `avatar_tone` | `TONES[ Math.floorMod(hash(userId), 6) ]`, `TONES = [mint, blue, peach, lav, amber, slate]` | 목업 철수=blue (목업과 일치시키려면 시드 데이터에서 직접 지정) |
| `today_kst` | `(now() AT TIME ZONE 'Asia/Seoul')::date` | 2026-10-12 |
| `is_late` | 최초 제출 시 `submitted_at > (end_date + 1 day) 00:00 KST` 이면 true, 이후 수정해도 불변 | 10/3 마감 과제를 10/4 00:10 KST 제출 → 지각 |
| 리마인더 대상일 | `end_date - today_kst ∈ {1, 3}` 이고 해당 토글 ON | 마감 10/15 → 10/12 D-3, 10/14 D-1 |
| 방 자동 종료일 | `end_date < today_kst` 즉 `end_date + 1` 의 00:00 | 12/31 종료 → 1/1 00:00 ENDED |
| 대기 만료 | 방 `ACTIVE` 전환 트랜잭션 내 `PENDING → EXPIRED` | 10/1 00:00 |
| OTP 만료 | `created_at + 10min`, 재전송 가능 `created_at + 60s` | |
| 알림 상대시간 | 프론트: `now - createdAt` → "방금/3분 전/2시간 전/어제/10월 3일" | |
| 알림 `link` | kind 별 매핑: 방 이벤트 → `routes.myStudy(roomId)`(참가자) / `routes.room(roomId)`(미참가·대기자), 과제 이벤트 → `routes.myStudy(roomId)?task={taskId}` | §7 참조 |

---

## 4. 엔티티·관계 후보

"공용" = 다른 화면 분석 문서에서도 등장.

```
users                         공용
  id BIGSERIAL PK
  email CITEXT UNIQUE NOT NULL
  nickname VARCHAR(16) NULL            -- NULL = 온보딩 미완료
  nickname_normalized VARCHAR(16) UNIQUE
  avatar_tone VARCHAR(8) NOT NULL
  optional_mail_enabled BOOL DEFAULT true
  created_at, last_login_at TIMESTAMPTZ

email_otps
  id BIGSERIAL PK
  email CITEXT NOT NULL (INDEX)
  code_hash BYTEA NOT NULL
  attempts SMALLINT DEFAULT 0
  expires_at, consumed_at, created_at TIMESTAMPTZ
  request_ip INET

refresh_tokens
  id UUID PK (token 자체는 해시 저장: token_hash)
  user_id FK users
  family_id UUID                       -- 회전 체인, 재사용 감지 시 family 전체 revoke
  expires_at, revoked_at, created_at TIMESTAMPTZ
  user_agent TEXT

room_invites
  token VARCHAR(32) PK
  room_id FK rooms (INDEX)             공용(rooms)
  created_by FK users
  created_at, revoked_at, expires_at(NULL) TIMESTAMPTZ

notifications
  id BIGSERIAL PK
  user_id FK users (INDEX user_id, read_at, id DESC)
  kind VARCHAR(32) NOT NULL
  title VARCHAR(200) NOT NULL
  body VARCHAR(500)
  room_id FK rooms NULL, node_id NULL, task_id NULL, actor_user_id NULL
  link VARCHAR(300) NOT NULL
  dedupe_key VARCHAR(120) UNIQUE
  created_at, read_at TIMESTAMPTZ

room_notification_settings
  room_id PK FK rooms
  reminder_d1, reminder_d3, task_assigned, schedule_changed, room_start_end BOOL
  completion_mode VARCHAR(16)

mail_outbox                   (2단계 워커, 1단계 테이블만)
  id, user_id, template, model JSONB, status, attempts, next_try_at, sent_at

files
  id UUID PK
  owner_user_id FK users, room_id FK rooms, task_id FK goal_nodes, submission_id FK submissions NULL
  object_key TEXT UNIQUE, original_name VARCHAR(255), content_type VARCHAR(100), size_bytes BIGINT
  status VARCHAR(10)  -- PENDING | READY | DELETED
  created_at, completed_at, deleted_at TIMESTAMPTZ

tags                          공용(방 목록 필터)
  slug VARCHAR(40) PK, label VARCHAR(20) UNIQUE, tone VARCHAR(8), aliases TEXT[], usage_count INT

room_tags                     공용
  room_id FK, tag_slug FK, source VARCHAR(8), created_at   PK(room_id, tag_slug)

room_tag_suppressions
  room_id FK, tag_slug FK   PK(room_id, tag_slug)

shedlock                      (ShedLock 표준 테이블)
```

다른 문서와의 접점: `rooms.status/start_date/end_date/visibility/join_mode`, `room_members.status(ACTIVE|PENDING|INACTIVE|EXPIRED|REJECTED)`, `goal_nodes.depth/start_date/end_date`, `task_assignees`, `submissions.is_late/first_submitted_at` 은 방/커리큘럼/제출 분석 문서가 주인이고 이 문서는 참조만 한다.

---

## 5. API 후보

base `/api/v1`, 응답 shape 는 §1 Read model 과 1:1.

| METHOD path | 요청 | 응답 | 권한 |
|---|---|---|---|
| `POST /auth/otp/request` | `{email}` | `{expiresInSec, resendAfterSec}` | 공개(rate limit) |
| `POST /auth/otp/verify` | `{email, code, returnTo?}` | `{user: Me, needsOnboarding, returnTo}` + Set-Cookie | 공개 |
| `POST /auth/refresh` | 쿠키 | `{}` + Set-Cookie | refresh 쿠키 |
| `POST /auth/logout` | 쿠키 | 204 + 쿠키 삭제 | 로그인 |
| `GET /me` | | `Me {id, nickname, initial, tone, email, onboarded, optionalMailEnabled}` | 로그인 |
| `PATCH /me` | `{nickname?, optionalMailEnabled?}` | `Me` | 로그인 |
| `GET /users/nickname-check?value=` | | `{available, reason?}` | 로그인 |
| `GET /notifications?cursor&limit` | | `{items: Notification[], nextCursor}` | 로그인 |
| `GET /notifications/unread-count` | | `{count}` | 로그인 |
| `POST /notifications/{id}/read` | | 204 | 본인 |
| `POST /notifications/read-all` | | `{updated}` | 로그인 |
| `GET /rooms/{id}/notification-settings` | | `RoomNotificationSettings` | 그룹장 |
| `PUT /rooms/{id}/notification-settings` | `RoomNotificationSettings` | 동일 | 그룹장 |
| `GET /invite/{token}` | | `InvitePreview` | 공개 |
| `POST /invite/{token}/join` | | `{joinState: "joined"\|"pending"}` | 로그인+온보딩 |
| `POST /rooms/{id}/invites` | | `{token, url}` (기존 무효화) | 그룹장 |
| `POST /rooms/{id}/tasks/{taskId}/attachments/presign` | `{fileName,size,contentType}` | `{fileId, uploadUrl, headers, expiresInSec}` | 담당자 |
| `POST /rooms/{id}/tasks/{taskId}/attachments/{fileId}/complete` | | `FileMeta` | 소유자 |
| `GET /files/{fileId}/url` | | `{url, expiresInSec}` | 같은 방 참가자 |
| `GET /tags?q=` | | `Tag[]`(자동완성, 상위 20) | 공개 |
| `GET /rooms/{id}/tags` | | `RoomTag[] {slug,label,tone,auto}` | 공개 방: 공개 / 비공개: 참가자 |
| `PUT /rooms/{id}/tags` | `{slugs[], freeLabels[]}` | `RoomTag[]` | 그룹장 |
| `POST /rooms/{id}/tags/suggest` | | `202 {jobId}` (수동 재실행) | 그룹장 |
| `GET /meta` | | `{today: "2026-10-12", serverTime, version}` | 공개 |

---

## 6. 목업 ↔ 실데이터 전환 포인트 (프론트 공용)

| 목업 | 현재 시그니처 | 전환 후 | 비고 |
|---|---|---|---|
| `ME` (`src/lib/routes.ts`) | `const ME = {name, initial, tone}` | `useMe()` 훅 / 서버 컴포넌트 `getMe()` → `Me` DTO | `AppHeader` 가 import. `id`·`email` 추가 |
| `TODAY` | `const TODAY = "2026-10-12"` | `GET /meta.today` 를 루트 레이아웃에서 1회 받아 컨텍스트로 전달 | `src/lib/date.ts` 의 모든 호출이 이 값을 인자로 받도록 리팩터 필요 |
| `AppHeader unread` | prop 기본값 3 | `GET /notifications/unread-count` 폴링 | 드롭다운 컴포넌트는 미구현 → 신규 |
| `toneOf(name)` (`palette.ts`) | 이름 해시 아님, 하드코딩 맵 | 각 member DTO 의 `tone` 사용 | `NAME_TONE` 은 시드 데이터 생성용으로만 유지 |
| `RoomTag {label, tone, auto}` (room-view, my-study) | 그대로 | `GET /rooms/{id}/tags` 가 같은 shape 반환 | `slug` 추가 |
| 로그인/온보딩/초대/`/me` 화면 | **없음** | 신규 라우트 4개 + `routes.login(returnTo)`, `routes.onboarding()`, `routes.invite(token)`, `routes.me()` 추가 | 디자인 시안도 없음(§7) |
| API 클라이언트 | 없음 | `src/lib/api.ts`: `fetch(NEXT_PUBLIC_API_URL + path, {credentials:"include"})` + 401 → refresh 1회 → 실패 시 `/login?returnTo=` | 서버 컴포넌트에선 `cookies()` 를 헤더로 전달 |
| 목업에서만 가능한 것 | 항상 로그인 상태, 항상 철수, 날짜 고정, 알림 3개 | | 비로그인 헤더 변형(로고+로그인 버튼) 미구현 |

---

## 7. 디자인 프롬프트에 있으나 화면에 없는 것 / 불명확한 것

| # | 항목 | 제안 기본값 |
|---|---|---|
| 1 | **세션 전략**(§2.1.5 A/B/C) | A(HttpOnly 쿠키, 커스텀 도메인 공유). 도메인 전까지 B(Next 프록시) |
| 2 | 라우트 불일치: 설계 IA 는 `/rooms/[slug]`, 프론트는 `/rooms/[id]`·`/my-study/[id]`, `/login`·`/onboarding`·`/invite`·`/me`·`/rooms/new` 화면 없음 | ID 는 slug 겸용 문자열 1종으로 통일(§7-3). 누락 화면 4개는 백엔드 API 먼저, 시안은 추후 |
| 3 | **ID 형식**: 프론트 목업 id `"aws"`, `"toeic"` | `rooms.id = BIGSERIAL` + `rooms.slug VARCHAR(40) UNIQUE`(생성 시 제목에서 slugify + 충돌 시 `-2`). **공개 URL·API path 는 slug**, 내부 FK 는 id. 알림 `room.id` 도 slug 로 내려 프론트 `routes.*` 와 직결 |
| 4 | 초대 토큰 만료 | 만료 없음 + 재발급으로 무효화 + 방 종료 시 무효 |
| 5 | 비공개 방: 비로그인·비참가자 접근 시 403 vs 404 | **404**(존재 비노출). 초대 미리보기만 예외 |
| 6 | 이탈자(`INACTIVE`)의 열람 권한 | 방·제출물 **읽기 유지**, 제출·수정·알림 불가 |
| 7 | 옵션 알림 설정이 방 단위인가 개인 단위인가 (§4.11 은 그룹장 설정탭, §4.13 은 개인 메일 토글) | 인앱 옵션 알림 = **방 단위**(그룹장), 메일 = 방 설정 AND 개인 토글 |
| 8 | 리마인더 발송 시각 | 09:00 KST. 00:00 은 수면 시간이라 메일 2단계와 맞추기 위해 |
| 9 | 자동 시작 조건 "말단 과제 1개 이상" 미충족 시 | 전환 보류 + 그룹장 `ROOM_START_BLOCKED` 알림, 매일 재시도 |
| 10 | 알림 `link` 가 가리킬 라우트 (과제 상세 `/rooms/[slug]/tasks/[id]` 화면 없음) | 1단계: `routes.myStudy(slug)?task={id}` (내 스터디에서 과제 포커스). 과제 상세 화면 생기면 교체 |
| 11 | 파일 저장소 | R2 또는 S3 + presigned. 로컬은 MinIO |
| 12 | 태그 LLM 공급자·비용 | 설정으로 교체 가능하게, 기본 keyword fallback 으로도 동작 |
| 13 | 알림 보존 기간 | 90일 후 삭제 배치 |
| 14 | 폴링 주기 | 60초, 탭 비활성 시 중단 |
| 15 | 날짜/시간 포맷 | 날짜 `YYYY-MM-DD`(KST, `DATE` 컬럼), 시각 ISO-8601 UTC `Z`. 프론트는 시각만 로컬 변환 |
| 16 | 에러 포맷 | `{ code: "ROOM_FULL", message: "정원이 찼어요", details?: {field: msg}, traceId }` + HTTP 상태. `code` 는 UPPER_SNAKE, 프론트 토스트 키 |
| 17 | 페이징 | 목록(방)은 `?page&size`(총 개수 필요), 알림은 `?cursor&limit`(무한 스크롤) |
| 18 | 버전 | `/api/v1` 경로 고정. 헤더 버전은 미사용 |
| 19 | ID 직렬화 | 숫자 id 는 JSON **문자열**로 내림(JS 53bit 안전) — 또는 slug/UUID 만 노출 |
| 20 | 비로그인 헤더(로고+로그인 버튼) | `AppHeader` 에 `me == null` 분기 추가 필요(프론트 통합 단계) |
