-- 로컬·테스트 전용 시드 (02-domain-and-schema.md §8). `supabase db reset` 이 마이그레이션 뒤에 실행한다.
-- 기준일 2026-10-12. 섹션 순서: §1 사용자(plan 01) → §2 방·멤버·전역 태그·room_tags(plan 02) → §3 커리큘럼·배정·제출(plan 03) → §4 알림·설정 등 나머지(plan 04).
-- §4 는 §2 의 태그와 §3 의 제출을 다시 넣지 않는다(이미 있는 행은 읽기만). 각 섹션은 아래 기준일(internal.settings 'today') 줄 **위에**, 각자 하나의 do 블록으로 끼워 넣는다.

-- ═══════════ §1 사용자 (plan 01) ═══════════
-- 목업 등장 인물 전원. avatar_tone = src/lib/palette.ts NAME_TONE. uuid = 00000000-0000-4000-8000-0000000000NN.
-- 로컬 전용: auth.users 직접 INSERT(비밀번호 없음 — 로컬 로그인은 OTP/Inbucket). 호스팅에는 절대 돌리지 않는다.
-- supabase CLI 는 seed 를 pgx 배치로 보내 모든 문장을 먼저 Parse 한다 → 앞 문장이 만든 임시 테이블을 뒷 문장이 참조하면
-- `relation does not exist` 로 실패한다. 섹션은 문장 사이에 객체를 주고받지 않게 하나의 do 블록으로 감싼다.
do $seed1$
begin
  create temp table if not exists seed_users (n int primary key, email_local text, nickname text, tone text);
  insert into seed_users (n, email_local, nickname, tone) values
    ( 1, 'cheolsu',  '철수', 'blue'),
    ( 2, 'minsu',    '민수', 'mint'),
    ( 3, 'seoyeon',  '서연', 'blue'),
    ( 4, 'jihun',    '지훈', 'lav'),
    ( 5, 'hyeonu',   '현우', 'slate'),
    ( 6, 'sumin',    '수민', 'peach'),
    ( 7, 'yerin',    '예린', 'amber'),
    ( 8, 'taeho',    '태호', 'blue'),
    ( 9, 'gaeun',    '가은', 'amber'),
    (10, 'minjae',   '민재', 'mint'),
    (11, 'boram',    '보람', 'mint'),
    (12, 'dohyeon',  '도현', 'mint'),
    (13, 'haeun',    '하은', 'mint'),
    (14, 'siu',      '시우', 'mint'),
    (15, 'jieun',    '지은', 'peach'),
    (16, 'soyul',    '소율', 'peach'),
    (17, 'jiseong',  '지성', 'peach'),
    (18, 'eunji',    '은지', 'peach'),
    (19, 'hana',     '하나', 'lav'),
    (20, 'daeun',    '다은', 'lav'),
    (21, 'taeyun',   '태윤', 'lav'),
    (22, 'nayeon',   '나연', 'lav'),
    (23, 'dain',     '다인', 'lav'),
    (24, 'doyun',    '도윤', 'slate'),
    (25, 'arin',     '아린', 'amber'),
    (26, 'yujin',    '유진', 'amber'),
    (27, 'junseo',   '준서', 'amber'),
    (28, 'hyeonjun', '현준', 'amber'),
    (29, 'seungho',  '승호', 'blue')
  on conflict (n) do nothing;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
         '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         email_local || '@sgtudy.local', '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
         '', '', '', '', ''
  from seed_users
  on conflict (id) do nothing;

  -- GoTrue 가 이메일 로그인에 요구하는 identity 행
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  select gen_random_uuid(), u.id, u.id::text, 'email',
         jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
         now(), now(), now()
  from auth.users u
  where u.email like '%@sgtudy.local'
  on conflict (provider_id, provider) do nothing;

  -- 트리거가 만든 profiles 에 닉네임·tone 지정
  update public.profiles p
     set nickname = s.nickname,
         nickname_normalized = public.nickname_normalize(s.nickname),
         avatar_tone = s.tone
    from seed_users s
   where p.id = ('00000000-0000-4000-8000-' || lpad(s.n::text, 12, '0'))::uuid;

  drop table seed_users;
end
$seed1$;

-- ═══════════ §2 태그 사전 · 방 · 멤버 · room_tags · 초대 · 알림 설정 (plan 02) ═══════════
-- 태그(tags·room_tags)는 이 섹션이 소유한다. plan 04 의 §4 는 태그를 다시 넣지 않는다(0009 마이그레이션의 사전 INSERT 와는 on conflict 로 공존).
-- 이 섹션은 §1 아래, 파일 마지막 `insert into internal.settings … 'today' …` 줄 **위**에 넣는다.
-- 기준일 2026-10-12. 숫자는 src/data/rooms.ts · src/data/room-view.ts 와 일치(docker 는 D3 에 따라 1/6).
-- 태그 slug 는 0009_tags.sql(plan 04) 과 같아야 한다. 양쪽 모두 on conflict (slug) do nothing.
do $seed2$
begin
insert into public.tags (slug, label, tone, aliases) values
  ('aws', 'AWS', 'mint', '{"amazon web services"}'),
  ('cloud', '클라우드', 'blue', '{"cloud"}'),
  ('certificate', '자격증', 'peach', '{"자격","certificate"}'),
  ('english', '영어', 'blue', '{"english"}'),
  ('toeic', '토익', 'peach', '{"toeic"}'),
  ('spring', 'Spring', 'mint', '{"스프링","spring boot"}'),
  ('backend', '백엔드', 'slate', '{"backend","서버"}'),
  ('java', 'Java', 'amber', '{"자바"}'),
  ('algorithm', '알고리즘', 'slate', '{"algorithm","ps"}'),
  ('coding-test', '코딩테스트', 'mint', '{"코테","coding test"}'),
  ('info-processing', '정보처리기사', 'amber', '{"정처기"}'),
  ('cs', 'CS', 'amber', '{"컴퓨터공학","computer science"}'),
  ('interview', '면접', 'lav', '{"interview"}'),
  ('react', 'React', 'blue', '{"리액트"}'),
  ('frontend', '프론트엔드', 'mint', '{"frontend","프론트"}'),
  ('docker', 'Docker', 'blue', '{"도커"}'),
  ('kubernetes', 'Kubernetes', 'lav', '{"k8s","쿠버네티스"}'),
  ('sql', 'SQL', 'amber', '{"sqld","쿼리"}'),
  ('data', '데이터', 'blue', '{"data"}')
on conflict (slug) do nothing;

-- 방 9개. id 고정(overriding system value). started_at/ended_at 은 KST 00:00.
insert into public.rooms (id, slug, title, intro, description_md, rules_md, start_date, end_date, max_members, min_members,
                          visibility, join_mode, leader_id, leader_does_tasks, status, member_count, started_at, ended_at, created_at, updated_at)
overriding system value
select v.id, v.slug, v.title, v.intro, v.description_md, v.rules_md, v.start_date::date, v.end_date::date, v.max_members, v.min_members,
       v.visibility, v.join_mode, p.id, v.slug <> 'sqld', v.status, v.member_count,
       v.started_at::timestamptz, v.ended_at::timestamptz, v.created_at::timestamptz, v.created_at::timestamptz
from (values
  (1, 'toeic', '토익 900 8주 챌린지', '매일 LC·RC 한 세트씩 풀고 오답 노트를 공유해요. 주말엔 모의고사 1회.',
   '8주 동안 매일 LC·RC 한 세트를 풀고, 틀린 문제는 오답 노트로 정리해 공유합니다. 주말에는 실전 모의고사 1회를 시간 맞춰 풀고 점수를 기록해요.',
   E'- 오답 노트에는 틀린 이유와 정답 근거를 함께 적어 주세요.\n- 모의고사는 120분 시간을 지켜서 풀어요.',
   '2026-11-02', '2026-12-27', 8, 4, 'PUBLIC', 'DIRECT', '서연', 'RECRUIT', 2, null, null, '2026-10-01 10:00+09'),
  (2, 'cs', 'CS 면접 질문 주 2회 — 운영체제·네트워크·데이터베이스 단골 질문 완전 정복하고 모의 면접까지', '운영체제·네트워크·DB 단골 질문을 주 2회 나눠 답변을 작성하고 서로 리뷰해요.',
   '월·목 주 2회, 회차마다 단골 면접 질문 2개에 대한 답변을 작성합니다. 서로의 답변에 댓글로 꼬리 질문을 남기고, 마지막 주에는 화상 모의 면접을 진행해요.',
   E'- 답변은 1분 안에 말할 수 있는 분량으로 작성해요.\n- 다른 사람 답변에 꼬리 질문을 1개 이상 남겨 주세요.',
   '2026-10-19', '2026-11-30', 6, 3, 'PUBLIC', 'DIRECT', '예린', 'RECRUIT', 3, null, null, '2026-10-02 10:00+09'),
  (3, 'sqld', 'SQLD 4주 벼락치기', '데이터 모델링부터 SQL 활용까지 4회차. 마지막 주는 모의고사로 마무리해요.',
   '11월 SQLD 시험 직전 4주 동안 핵심만 빠르게 정리합니다. 회차마다 요약 노트와 기출 풀이를 제출하고, 마지막 주에는 모의고사 2회를 함께 풀어요.',
   E'- 기출 풀이는 틀린 문제와 이유를 함께 적어 주세요.\n- 모의고사는 정해진 시간(90분)을 지켜 풀어요.',
   '2026-10-26', '2026-11-22', 5, 3, 'PUBLIC', 'APPROVAL', '가은', 'RECRUIT', 1, null, null, '2026-10-03 10:00+09'),
  (4, 'docker', 'Docker·K8s 입문 6주', '컨테이너 기초부터 쿠버네티스 배포까지, 매주 실습 결과를 스크린샷과 링크로 공유해요.',
   '도커 이미지 빌드부터 쿠버네티스에 서비스를 배포하기까지 6주 동안 단계별로 실습합니다. 매주 실습 결과를 스크린샷과 저장소 링크로 공유해요.',
   E'- 실습 환경은 각자 로컬(Docker Desktop 또는 minikube)을 사용해요.\n- 막힌 부분은 제출물에 그대로 적어 주면 함께 풀어 봐요.',
   '2026-11-09', '2026-12-20', 6, 2, 'PUBLIC', 'DIRECT', '철수', 'RECRUIT', 1, null, null, '2026-10-04 10:00+09'),
  (5, 'jcg', '정보처리기사 실기 2주 완성', '기출 회독 3회와 약점 단원 집중. 매일 저녁 9시 진도 체크.',
   '실기 시험 직전 2주 동안 기출을 3회독하고, 자주 틀리는 단원을 골라 집중적으로 다시 풉니다. 매일 저녁 9시에 진도를 체크해요.',
   E'- 매일 21시까지 그날 푼 회차를 제출해 주세요.\n- 오답은 단원별로 모아서 정리해요.',
   '2026-10-19', '2026-11-01', 4, 3, 'PUBLIC', 'APPROVAL', '수민', 'RECRUIT', 4, null, null, '2026-10-05 10:00+09'),
  (6, 'aws', 'AWS SAA 자격증 3개월 완주', 'IAM부터 고가용성 아키텍처까지, 매주 회차별 과제로 SAA-C03 합격까지 함께 달려요.',
   'AWS Solutions Architect – Associate(SAA-C03) 합격을 목표로 3개월간 13회차를 진행합니다. 매주 목요일에 새 회차가 열리고, 회차마다 공통 과제와 지정 과제가 있어요.',
   E'- 마감은 회차 마지막 날 23:59(KST)예요. 늦게라도 제출하면 지각으로 기록돼요.\n- 2회 연속 미제출 시 그룹장과 상의 후 이탈 처리될 수 있어요.',
   '2026-10-01', '2026-12-31', 6, 3, 'PUBLIC', 'APPROVAL', '민수', 'ACTIVE', 4, '2026-10-01 00:00+09', null, '2026-09-15 10:00+09'),
  (7, 'react', '리액트 공식문서 함께 읽기', 'react.dev Learn 섹션을 주차별로 읽고, 챕터마다 작은 예제를 만들어 공유합니다.',
   'react.dev의 Learn 섹션을 8주에 나눠 읽습니다. 챕터마다 핵심을 정리하고, 직접 만든 작은 예제를 CodeSandbox 링크로 공유해요.',
   E'- 예제는 공식문서와 다른 주제로 직접 만들어 주세요.\n- 정리 노트에는 이해가 안 된 부분도 솔직하게 적어요.',
   '2026-09-21', '2026-11-15', 8, 3, 'PUBLIC', 'DIRECT', '태호', 'ACTIVE', 5, '2026-09-21 00:00+09', null, '2026-09-01 10:00+09'),
  (8, 'algo', '알고리즘 매일 1문제', '백준·프로그래머스에서 하루 한 문제. 풀이와 회고를 짧게 남기는 13주 습관 만들기.',
   '매일 한 문제를 풀고 짧은 회고를 남기는 습관 스터디였어요. 주 단위로 7문제 중 5문제 이상 풀면 그 주 과제를 달성한 것으로 봤습니다.',
   E'- 풀이 언어는 자유, 회고는 3줄 이내로 남겨요.\n- 주 5문제 이상 풀면 주간 과제 달성으로 기록해요.',
   '2026-07-01', '2026-09-30', 6, 2, 'PUBLIC', 'DIRECT', '현우', 'ENDED', 6, '2026-07-01 00:00+09', '2026-10-01 00:00+09', '2026-06-15 10:00+09'),
  (9, 'spring', 'Spring 김영한 로드맵 완강', '핵심 원리부터 JPA 활용까지 로드맵 순서대로, 섹션별 정리 노트를 제출합니다.',
   '김영한 스프링 로드맵을 순서대로 완강합니다. 섹션을 묶어 회차로 나누고, 회차마다 정리 노트와 실습 저장소 링크를 제출해요.',
   E'- 정리 노트는 섹션별 핵심 개념 3가지 이상을 포함해요.\n- 실습 코드는 공개 저장소 링크로 공유해요.',
   '2026-10-05', '2027-01-31', 5, null, 'PRIVATE', 'APPROVAL', '지훈', 'ACTIVE', 5, '2026-10-05 00:00+09', null, '2026-09-20 10:00+09')
) as v(id, slug, title, intro, description_md, rules_md, start_date, end_date, max_members, min_members,
       visibility, join_mode, leader, status, member_count, started_at, ended_at, created_at)
join public.profiles p on p.nickname = v.leader
on conflict (id) do nothing;

perform setval(pg_get_serial_sequence('public.rooms', 'id'), greatest((select max(id) from public.rooms), 9));

-- 멤버. joined_at 은 "참가 확정 순"(그룹장 먼저). 철수 sqld 는 PENDING, 도윤 aws 는 INACTIVE.
insert into public.room_members (room_id, user_id, role, status, applied_at, joined_at, left_at)
select r.id, p.id, v.role, v.status, v.applied_at::timestamptz, v.joined_at::timestamptz, v.left_at::timestamptz
from (values
  ('toeic', '서연', 'LEADER', 'ACTIVE', null, '2026-10-01 10:00+09', null),
  ('toeic', '도현', 'MEMBER', 'ACTIVE', null, '2026-10-06 12:00+09', null),
  ('cs', '예린', 'LEADER', 'ACTIVE', null, '2026-10-02 10:00+09', null),
  ('cs', '승호', 'MEMBER', 'ACTIVE', null, '2026-10-04 09:00+09', null),
  ('cs', '나연', 'MEMBER', 'ACTIVE', null, '2026-10-05 09:00+09', null),
  ('sqld', '가은', 'LEADER', 'ACTIVE', null, '2026-10-03 10:00+09', null),
  ('sqld', '철수', 'MEMBER', 'PENDING', '2026-10-10 09:00+09', null, null),
  ('docker', '철수', 'LEADER', 'ACTIVE', null, '2026-10-04 10:00+09', null),
  ('jcg', '수민', 'LEADER', 'ACTIVE', null, '2026-10-05 10:00+09', null),
  ('jcg', '태윤', 'MEMBER', 'ACTIVE', '2026-10-06 09:00+09', '2026-10-06 10:00+09', null),
  ('jcg', '하은', 'MEMBER', 'ACTIVE', '2026-10-07 09:00+09', '2026-10-07 10:00+09', null),
  ('jcg', '준서', 'MEMBER', 'ACTIVE', '2026-10-08 09:00+09', '2026-10-08 10:00+09', null),
  ('aws', '민수', 'LEADER', 'ACTIVE', null, '2026-09-15 10:00+09', null),
  ('aws', '지은', 'MEMBER', 'ACTIVE', '2026-09-20 09:00+09', '2026-09-20 10:00+09', null),
  ('aws', '철수', 'MEMBER', 'ACTIVE', '2026-09-21 09:00+09', '2026-09-21 10:00+09', null),
  ('aws', '하나', 'MEMBER', 'ACTIVE', '2026-09-22 09:00+09', '2026-09-22 10:00+09', null),
  ('aws', '도윤', 'MEMBER', 'INACTIVE', '2026-09-23 09:00+09', '2026-09-23 10:00+09', '2026-10-06 09:00+09'),
  ('react', '태호', 'LEADER', 'ACTIVE', null, '2026-09-01 10:00+09', null),
  ('react', '은지', 'MEMBER', 'ACTIVE', null, '2026-09-05 10:00+09', null),
  ('react', '시우', 'MEMBER', 'ACTIVE', null, '2026-09-06 10:00+09', null),
  ('react', '다인', 'MEMBER', 'ACTIVE', null, '2026-09-07 10:00+09', null),
  ('react', '현준', 'MEMBER', 'ACTIVE', null, '2026-09-08 10:00+09', null),
  ('algo', '현우', 'LEADER', 'ACTIVE', null, '2026-06-15 10:00+09', null),
  ('algo', '철수', 'MEMBER', 'ACTIVE', null, '2026-06-20 10:00+09', null),
  ('algo', '보람', 'MEMBER', 'ACTIVE', null, '2026-06-21 10:00+09', null),
  ('algo', '지성', 'MEMBER', 'ACTIVE', null, '2026-06-22 10:00+09', null),
  ('algo', '다은', 'MEMBER', 'ACTIVE', null, '2026-06-23 10:00+09', null),
  ('algo', '유진', 'MEMBER', 'ACTIVE', null, '2026-06-24 10:00+09', null),
  ('spring', '지훈', 'LEADER', 'ACTIVE', null, '2026-09-20 10:00+09', null),
  ('spring', '철수', 'MEMBER', 'ACTIVE', '2026-09-25 09:00+09', '2026-09-25 10:00+09', null),
  ('spring', '민재', 'MEMBER', 'ACTIVE', '2026-09-26 09:00+09', '2026-09-26 10:00+09', null),
  ('spring', '소율', 'MEMBER', 'ACTIVE', '2026-09-27 09:00+09', '2026-09-27 10:00+09', null),
  ('spring', '아린', 'MEMBER', 'ACTIVE', '2026-09-28 09:00+09', '2026-09-28 10:00+09', null)
) as v(slug, nickname, role, status, applied_at, joined_at, left_at)
join public.rooms r on r.slug = v.slug
join public.profiles p on p.nickname = v.nickname
on conflict (room_id, user_id) do nothing;

-- 방 태그(노출 순서 = sort_order, auto = room-view.ts 의 ✦)
insert into public.room_tags (room_id, tag_slug, source, sort_order)
select r.id, v.tag, case when v.auto then 'AUTO' else 'MANUAL' end, v.ord
from (values
  ('toeic', 'english', true, 0), ('toeic', 'toeic', true, 1),
  ('cs', 'cs', true, 0), ('cs', 'interview', false, 1),
  ('sqld', 'sql', true, 0), ('sqld', 'data', true, 1), ('sqld', 'certificate', false, 2),
  ('docker', 'docker', true, 0), ('docker', 'kubernetes', true, 1), ('docker', 'cloud', false, 2),
  ('jcg', 'certificate', true, 0), ('jcg', 'info-processing', false, 1),
  ('aws', 'aws', true, 0), ('aws', 'cloud', true, 1), ('aws', 'certificate', false, 2),
  ('react', 'react', true, 0), ('react', 'frontend', true, 1),
  ('algo', 'algorithm', true, 0), ('algo', 'coding-test', true, 1),
  ('spring', 'spring', true, 0), ('spring', 'backend', true, 1), ('spring', 'java', true, 2)
) as v(slug, tag, auto, ord)
join public.rooms r on r.slug = v.slug
on conflict (room_id, tag_slug) do nothing;

-- 초대 토큰(방당 활성 1개) · 알림 설정(기본값)
insert into public.room_invites (token, room_id, created_by)
select 'seed-' || r.slug, r.id, r.leader_id from public.rooms r where r.id <= 9
on conflict (token) do nothing;

insert into public.room_notification_settings (room_id)
select r.id from public.rooms r where r.id <= 9
on conflict (room_id) do nothing;

-- D4: 공통 과제 담당자 실체화(지금은 노드가 없어 no-op, plan 03 시드 §3 뒤에 다시 호출된다)
perform public.assignment_resync(r.id) from public.rooms r;
end
$seed2$;

-- ═══════════ §3 커리큘럼 (plan 03) ═══════════
-- src/data/my-study.ts PLANS 원본(aws·spring·sqld·algo)과 src/data/room-view.ts 회차(toeic·cs·docker·jcg·react).
-- 코드 문자열은 PLANS.members 순서: D 기한내(end_date 18:00 KST, 기준일 10/12 10:00 KST 를 넘으면 그 시각으로 clamp) / L 지각(end_date+1 09:00 KST) / M·O·P 미제출 / - 미배정.
-- 공통 리프의 배정은 섹션 끝 assignment_resync 가 만든다. 지정 리프는 '-' 아닌 자리만 DESIGNATED 행.
-- 멱등: goal_nodes 가 하나라도 있으면 건너뛴다(플랜 01 seed 테스트가 seed.sql 을 두 번 적용한다).

do $seed3$
declare
  aws    text[] := array['민수', '지은', '철수', '하나'];
  spring text[] := array['지훈', '철수', '소율', '민재', '아린'];
  sqld   text[] := array['가은'];
  algo   text[] := array['현우', '철수', '보람', '지성', '다은', '유진'];
  react  text[] := array['태호', '은지', '시우', '다인', '현준'];
  r bigint; r1 bigint; r2 bigint; r3 bigint; m bigint; w int; s date; v_codes text;
  algo_codes text[] := array['DDDDDD', 'DDDMDD', 'DDDDDD', 'DDDDDD', 'DDDDDM', 'DDDMDD', 'DDMDDD', 'DDDDDD',
                             'DMDDDD', 'DDDMDD', 'DMDDDD', 'DDDDMM', 'DDDDDM'];   -- algoMiss: 2 지성, 5 유진, 6 지성, 7 보람, 9 철수, 10 지성, 11 철수, 12 다은·유진, 13 유진
  toeic_t text[] := array['LC Part 1·2', 'RC Part 5·6', 'LC Part 3·4', 'RC Part 7', 'LC 종합', 'RC 종합', '실전 모의고사 ①', '실전 모의고사 ②'];
  cs_t    text[] := array['운영체제 ① 프로세스·스레드', '운영체제 ② 메모리', '네트워크 ① TCP/IP', '네트워크 ② HTTP·HTTPS',
                          '데이터베이스 ① 인덱스', '데이터베이스 ② 트랜잭션', '운영체제 ③ 동기화', '네트워크 ③ DNS·CDN',
                          '데이터베이스 ③ 정규화', '자료구조 총정리', '종합 질문', '모의 면접'];
  docker_t text[] := array['컨테이너와 이미지', 'Dockerfile·Compose', '쿠버네티스 기본 오브젝트', '서비스·인그레스', '설정·스토리지', '배포 파이프라인'];
  docker_n int[]  := array[2, 1, 2, 1, 1, 1];
  react_t text[] := array['UI 표현하기 ①', 'UI 표현하기 ②', '상호작용 더하기', '상태 관리하기', '탈출구(Escape Hatches)', '탈출구 ②', '종합 프로젝트 ①', '종합 프로젝트 ②'];
  react_a text[] := array['JSX·컴포넌트 정리 노트', '조건부 렌더링 노트', '이벤트·state 노트', '리듀서로 상태 로직 옮기기', 'ref·effect 노트', '커스텀 훅 노트', '미니 앱 설계 노트', '미니 앱 완성'];
  react_b text[] := array['props 예제', '리스트 렌더링 예제', '렌더링 과정 예제', 'Context로 props 전달 줄이기', 'effect 의존성 예제', '커스텀 훅 예제', '미니 앱 1차 구현', '회고 노트'];
begin
  if exists (select 1 from public.goal_nodes) then
    raise notice 'seed §3: goal_nodes already present — skipped';
    return;
  end if;

  -- 임시 헬퍼(D1: do 블록 안에서 만들고 끝에서 지운다). 본문은 $f$ 로 인용.
  execute $fn$
create or replace function pg_temp.kst_at(p_d date, p_h int) returns timestamptz
language sql as $f$ select (p_d::timestamp + make_interval(hours => p_h)) at time zone 'Asia/Seoul' $f$;
  $fn$;
  execute $fn$
create or replace function pg_temp.seed_round(p_slug text, p_label text, p_title text, p_s date, p_e date) returns bigint
language plpgsql as $f$
declare v_room bigint; v_id bigint; v_n int;
begin
  select id into v_room from public.rooms where slug = p_slug;
  if v_room is null then raise exception 'seed §3: room % missing (plan 02 §2 first)', p_slug; end if;
  select count(*) into v_n from public.goal_nodes where room_id = v_room and parent_id is null;
  insert into public.goal_nodes (room_id, parent_id, depth, sort_order, label, title, start_date, end_date)
  values (v_room, null, 2, v_n, p_label, p_title, p_s, p_e) returning id into v_id;
  update public.goal_nodes set round_id = v_id where id = v_id;
  return v_id;
end $f$;
  $fn$;
  -- 중간 노드(자식을 가질 노드). task_type null
  execute $fn$
create or replace function pg_temp.seed_node(p_parent bigint, p_title text, p_s date, p_e date) returns bigint
language plpgsql as $f$
declare p public.goal_nodes; v_id bigint; v_n int;
begin
  select * into p from public.goal_nodes where id = p_parent;
  select count(*) into v_n from public.goal_nodes where parent_id = p_parent;
  insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date)
  values (p.room_id, p.id, p.round_id, p.depth + 1, v_n, p_title, p_s, p_e) returning id into v_id;
  return v_id;
end $f$;
  $fn$;
  -- 리프 + 코드. p_names 는 p_codes 와 같은 순서의 닉네임. D 제출 시각은 기준일 10/12 10:00 KST 로 clamp(미래 시각 금지 — C5)
  execute $fn$
create or replace function pg_temp.seed_leaf(p_parent bigint, p_title text, p_type text, p_s date, p_e date,
                                             p_codes text default null, p_names text[] default null) returns bigint
language plpgsql as $f$
declare p public.goal_nodes; v_id bigint; v_n int; i int; v_c text; v_user uuid;
begin
  select * into p from public.goal_nodes where id = p_parent;
  select count(*) into v_n from public.goal_nodes where parent_id = p_parent;
  insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, title, start_date, end_date, task_type)
  values (p.room_id, p.id, p.round_id, p.depth + 1, v_n, p_title, p_s, p_e, p_type) returning id into v_id;
  if p_codes is null then return v_id; end if;
  if length(p_codes) <> coalesce(array_length(p_names, 1), 0) then
    raise exception 'seed §3: codes "%" vs names % length mismatch (%)', p_codes, p_names, p_title;
  end if;
  for i in 1 .. length(p_codes) loop
    v_c := substr(p_codes, i, 1);
    select id into v_user from public.profiles where nickname = p_names[i];
    if v_user is null then raise exception 'seed §3: user % missing', p_names[i]; end if;
    if p_type = 'DESIGNATED' and v_c <> '-' then
      insert into public.task_assignments (node_id, user_id, source) values (v_id, v_user, 'DESIGNATED');
    end if;
    if v_c = 'D' then
      insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late, updated_at)
      values (v_id, v_user, '## ' || p_title || E'\n\n' || p_names[i] || ' 제출', least(pg_temp.kst_at(p_e, 18), timestamptz '2026-10-12 10:00+09'), false,
              least(pg_temp.kst_at(p_e, 18), timestamptz '2026-10-12 10:00+09'));
    elsif v_c = 'L' then
      insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late, updated_at)
      values (v_id, v_user, '## ' || p_title || E'\n\n' || p_names[i] || ' 지각 제출', pg_temp.kst_at(p_e + 1, 9), true, pg_temp.kst_at(p_e + 1, 9));
    end if;
  end loop;
  return v_id;
end $f$;
  $fn$;

  -- ── aws (PLANS.aws) ──
  r := pg_temp.seed_round('aws', '1주차', 'IAM·VPC', '2026-10-01', '2026-10-07');
  perform pg_temp.seed_leaf(r, 'IAM 정책 이해', 'COMMON', '2026-10-01', '2026-10-03', 'DLDM', aws);
  perform pg_temp.seed_leaf(r, 'VPC 실습',      'COMMON', '2026-10-04', '2026-10-07', 'DMDM', aws);
  r := pg_temp.seed_round('aws', '2주차', 'EC2·S3', '2026-10-08', '2026-10-14');
  perform pg_temp.seed_leaf(r, 'EC2 인스턴스 유형 정리',       'DESIGNATED', '2026-10-08', '2026-10-14', '-DO-', aws);
  perform pg_temp.seed_leaf(r, 'S3 스토리지 클래스 발표자료', 'DESIGNATED', '2026-10-10', '2026-10-14', '---O', aws);
  r := pg_temp.seed_round('aws', '3주차', '고가용성 아키텍처', '2026-10-15', '2026-10-21');
  m := pg_temp.seed_node(r, '로드밸런서 비교', '2026-10-15', '2026-10-21');
  perform pg_temp.seed_leaf(m, 'ALB vs NLB 실습', 'COMMON', '2026-10-15', '2026-10-21', 'PPPP', aws);
  r := pg_temp.seed_round('aws', '4주차', '오토스케일링', '2026-10-22', '2026-10-28');
  perform pg_temp.seed_leaf(r, 'Auto Scaling 정책 정리', 'COMMON', '2026-10-22', '2026-10-28', 'PPPP', aws);
  r := pg_temp.seed_round('aws', '5주차', '데이터베이스', '2026-10-29', '2026-11-04');
  perform pg_temp.seed_leaf(r, 'RDS·Aurora 비교',    'COMMON',     '2026-10-29', '2026-11-04', 'PPPP', aws);
  perform pg_temp.seed_leaf(r, 'DynamoDB 설계 퀴즈', 'DESIGNATED', '2026-11-01', '2026-11-04', '-P-P', aws);

  -- ── spring (PLANS.spring) ──
  r := pg_temp.seed_round('spring', '1주차', '핵심 원리 기본편 (전반)', '2026-10-05', '2026-10-11');
  perform pg_temp.seed_leaf(r, '섹션 1~5 정리 노트',  'COMMON', '2026-10-05', '2026-10-11', 'DDDDD', spring);
  perform pg_temp.seed_leaf(r, '스프링 컨테이너 실습', 'COMMON', '2026-10-08', '2026-10-11', 'DLDDM', spring);
  r := pg_temp.seed_round('spring', '2주차', '핵심 원리 기본편 (후반)', '2026-10-12', '2026-10-18');
  perform pg_temp.seed_leaf(r, '섹션 6~7 정리 노트',         'COMMON', '2026-10-12', '2026-10-18', 'DODDO', spring);
  perform pg_temp.seed_leaf(r, '싱글톤 컨테이너 실습 코드', 'COMMON', '2026-10-15', '2026-10-18', 'PPPPP', spring);
  r := pg_temp.seed_round('spring', '3주차', '스프링 MVC 1편', '2026-10-19', '2026-10-25');
  perform pg_temp.seed_leaf(r, 'MVC 구조 이해 노트',   'COMMON', '2026-10-19', '2026-10-25', 'PPPPP', spring);
  perform pg_temp.seed_leaf(r, '서블릿→MVC 리팩토링', 'COMMON', '2026-10-22', '2026-10-25', 'PPPPP', spring);
  r := pg_temp.seed_round('spring', '4주차', 'MVC 1편 (후반)', '2026-10-26', '2026-11-01');
  perform pg_temp.seed_leaf(r, 'MVC 1편 섹션 5~7 노트', 'COMMON', '2026-10-26', '2026-11-01', 'PPPPP', spring);

  -- ── sqld (PLANS.sqld) — 가은은 leader_does_tasks=false 라 공통 리프 asg=0 (D5: sqld null) ──
  -- (§2 가 이미 sqld.leader_does_tasks=false 로 넣는다 — C2: 별도 update 불필요)
  r := pg_temp.seed_round('sqld', '1주차', '데이터 모델링의 이해', '2026-10-26', '2026-11-01');
  perform pg_temp.seed_leaf(r, '데이터 모델링 요약 노트', 'COMMON', '2026-10-26', '2026-11-01', 'P', sqld);
  perform pg_temp.seed_leaf(r, '1과목 기출 풀이',         'COMMON', '2026-10-29', '2026-11-01', 'P', sqld);
  r := pg_temp.seed_round('sqld', '2주차', 'SQL 기본', '2026-11-02', '2026-11-08');
  perform pg_temp.seed_leaf(r, 'SELECT·JOIN 정리',        'COMMON',     '2026-11-02', '2026-11-05', 'P', sqld);
  perform pg_temp.seed_leaf(r, '내장 함수 실습',          'COMMON',     '2026-11-04', '2026-11-08', 'P', sqld);
  perform pg_temp.seed_leaf(r, '2과목 기출 풀이 (전반)', 'DESIGNATED', '2026-11-06', '2026-11-08', '-', sqld);
  r := pg_temp.seed_round('sqld', '3주차', 'SQL 활용', '2026-11-09', '2026-11-15');
  perform pg_temp.seed_leaf(r, '서브쿼리·윈도우 함수',    'COMMON', '2026-11-09', '2026-11-15', 'P', sqld);
  perform pg_temp.seed_leaf(r, '2과목 기출 풀이 (후반)', 'COMMON', '2026-11-12', '2026-11-15', 'P', sqld);
  r := pg_temp.seed_round('sqld', '4주차', '모의고사', '2026-11-16', '2026-11-22');
  perform pg_temp.seed_leaf(r, '모의고사 1회', 'COMMON', '2026-11-16', '2026-11-19', 'P', sqld);
  perform pg_temp.seed_leaf(r, '모의고사 2회', 'COMMON', '2026-11-20', '2026-11-22', 'P', sqld);

  -- ── algo (PLANS.algo: algoGroup/algoWeek — 그룹 e 는 마지막 주 e 인 09-29) ──
  r1 := pg_temp.seed_round('algo', '1–4주차',  '구현 · 그리디',          '2026-07-01', '2026-07-28');
  r2 := pg_temp.seed_round('algo', '5–8주차',  'BFS · DFS · 백트래킹',   '2026-07-29', '2026-08-25');
  r3 := pg_temp.seed_round('algo', '9–13주차', 'DP · 최단경로',          '2026-08-26', '2026-09-29');
  for w in 1 .. 13 loop
    s := date '2026-07-01' + (w - 1) * 7;
    perform pg_temp.seed_leaf(case when w <= 4 then r1 when w <= 8 then r2 else r3 end,
                              w || '주차 문제 풀이', 'COMMON', s, s + 6, algo_codes[w], algo);
  end loop;

  -- ── react (room-view: 8회차 매주 월요일, 공통 2개씩, 3주차 9/10, 4주차 3/10) ──
  for w in 1 .. 8 loop
    s := date '2026-09-21' + (w - 1) * 7;
    r := pg_temp.seed_round('react', w || '주차', react_t[w], s, s + 6);
    v_codes := case when w <= 2 then 'DDDDD' when w = 3 then 'DDDDD' when w = 4 then 'DDODO' else 'PPPPP' end;
    perform pg_temp.seed_leaf(r, react_a[w], 'COMMON', s, s + 6, v_codes, react);
    v_codes := case when w <= 2 then 'DDDDD' when w = 3 then 'DDDDM' when w = 4 then 'PPPPP' else 'PPPPP' end;
    perform pg_temp.seed_leaf(r, react_b[w], 'COMMON', case when w = 4 then s + 3 else s end, s + 6, v_codes, react);
  end loop;

  -- ── toeic (8회차 매주 월요일 11-02~, 공통 2개씩) ──
  for w in 1 .. 8 loop
    s := date '2026-11-02' + (w - 1) * 7;
    r := pg_temp.seed_round('toeic', w || '주차', toeic_t[w], s, s + 6);
    perform pg_temp.seed_leaf(r, toeic_t[w] || ' 오답 노트', 'COMMON', s, s + 4);
    perform pg_temp.seed_leaf(r, '주말 모의고사 ' || w || '회', 'COMMON', s + 5, s + 6);
  end loop;

  -- ── cs (12회차, 월 3일·목 4일 교대, 10-19~11-29, 공통 2개씩) ──
  for w in 1 .. 12 loop
    s := date '2026-10-19' + ((w - 1) / 2) * 7 + case when w % 2 = 1 then 0 else 3 end;
    r := pg_temp.seed_round('cs', w || '회차', cs_t[w], s, s + case when w % 2 = 1 then 2 else 3 end);
    perform pg_temp.seed_leaf(r, '질문 1 답변', 'COMMON', s, s + case when w % 2 = 1 then 2 else 3 end);
    perform pg_temp.seed_leaf(r, '질문 2 답변', 'COMMON', s, s + case when w % 2 = 1 then 2 else 3 end);
  end loop;

  -- ── docker (6회차 매주 월요일 11-09~, 공통 2·1·2·1·1·1 = 8) ──
  for w in 1 .. 6 loop
    s := date '2026-11-09' + (w - 1) * 7;
    r := pg_temp.seed_round('docker', w || '주차', docker_t[w], s, s + 6);
    perform pg_temp.seed_leaf(r, docker_t[w] || ' 실습 ①', 'COMMON', s, s + 6);
    if docker_n[w] = 2 then perform pg_temp.seed_leaf(r, docker_t[w] || ' 실습 ②', 'COMMON', s + 3, s + 6); end if;
  end loop;

  -- ── jcg (2회차, 공통 3개씩) ──
  r := pg_temp.seed_round('jcg', '1주차', '필기 복습 · 기출 1회독', '2026-10-19', '2026-10-25');
  perform pg_temp.seed_leaf(r, '필기 핵심 요약',   'COMMON', '2026-10-19', '2026-10-21');
  perform pg_temp.seed_leaf(r, '기출 1회독',       'COMMON', '2026-10-21', '2026-10-25');
  perform pg_temp.seed_leaf(r, '오답 단원 정리',   'COMMON', '2026-10-24', '2026-10-25');
  r := pg_temp.seed_round('jcg', '2주차', '약점 단원 · 기출 2~3회독', '2026-10-26', '2026-11-01');
  perform pg_temp.seed_leaf(r, '약점 단원 집중',   'COMMON', '2026-10-26', '2026-10-28');
  perform pg_temp.seed_leaf(r, '기출 2회독',       'COMMON', '2026-10-28', '2026-10-30');
  perform pg_temp.seed_leaf(r, '기출 3회독·총정리', 'COMMON', '2026-10-30', '2026-11-01');

  -- ── 이탈자 도윤(aws INACTIVE): IAM 에 released 배정 + 제출물 (집계 제외, 제출물 보존 — D4·D14) ──
  insert into public.task_assignments (node_id, user_id, source, assigned_at, released_at)
  select n.id, p.id, 'COMMON', pg_temp.kst_at('2026-10-01', 0), pg_temp.kst_at('2026-10-06', 10)
  from public.goal_nodes n join public.rooms r on r.id = n.room_id, public.profiles p
  where r.slug = 'aws' and n.title = 'IAM 정책 이해' and p.nickname = '도윤';
  insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late, updated_at)
  select n.id, p.id, '## IAM 정책 이해' || E'\n\n' || '도윤 제출(이탈 전)', pg_temp.kst_at('2026-10-03', 18), false, pg_temp.kst_at('2026-10-03', 18)
  from public.goal_nodes n join public.rooms r on r.id = n.room_id, public.profiles p
  where r.slug = 'aws' and n.title = 'IAM 정책 이해' and p.nickname = '도윤';

  -- ── 공통 리프 배정 실체화 (D4) ──
  perform public.assignment_resync(id) from public.rooms;
  -- 배정 시각은 db reset 시각이 아니라 리프 시작일 00:00 KST 로 고정한다(제출 시각보다 항상 앞선다 — 플랜 04 불변식·리마인더가 이 값을 본다).
  -- (submissions.updated_at = first_submitted_at 은 BEFORE UPDATE 트리거가 덮어쓰므로 위 insert 에서 직접 지정했다.)
  update public.task_assignments a set assigned_at = pg_temp.kst_at(g.start_date, 0)
  from public.goal_nodes g where g.id = a.node_id;
  execute 'drop function pg_temp.seed_leaf(bigint,text,text,date,date,text,text[])';
  execute 'drop function pg_temp.seed_node(bigint,text,date,date)';
  execute 'drop function pg_temp.seed_round(text,text,text,date,date)';
  execute 'drop function pg_temp.kst_at(date,int)';
end $seed3$;

-- ═══════════ §4 알림 · 제출 링크 (plan 04) ═══════════
-- (room_notification_settings 행은 §2 가 이미 모든 시드 방에 넣는다.)
do $seed4$
declare v_n int;
begin
  -- 철수 미읽음 3건 (헤더 배지·드롭다운). 멱등: dedupe_key.
  -- created_at 이 오래된 것부터 INSERT 한다 → id 순서 = 시간 순서(목록은 id DESC 라 드롭다운이 최신순으로 보인다).
  -- 모두 기준일 10/12(KST) 이전 시각: D-3 리마인더 10/11 09:00 KST → spring 2주차 시작 10/12 00:00 KST → aws 일정 변경 10/12 10:30 KST
  insert into public.notifications (user_id, kind, title, body, room_id, node_id, actor_user_id, link, dedupe_key, created_at)
  select p.id, 'DEADLINE_REMINDER', '"EC2 인스턴스 유형 정리" 마감 3일 전이에요', r.title, r.id, n.id, null,
         '/my-study/aws?task=' || n.id, 'seed:DEADLINE_REMINDER:cheolsu', '2026-10-11 00:00:00+00'
  from public.profiles p, public.rooms r
  join public.goal_nodes n on n.room_id = r.id and n.title = 'EC2 인스턴스 유형 정리'
  where p.nickname = '철수' and r.slug = 'aws'
  on conflict (dedupe_key) do nothing;
  -- 조인이 비어(시드 드리프트) 0행이 들어가면 조용히 넘어가지 않는다. 재실행(이미 있음)은 통과
  get diagnostics v_n = row_count;
  if v_n = 0 and not exists (select 1 from public.notifications where dedupe_key = 'seed:DEADLINE_REMINDER:cheolsu') then
    raise exception 'seed §4: 철수 DEADLINE_REMINDER 알림이 0행 — 시드 데이터가 어긋났어요';
  end if;

  -- job_round_started 의 자연 키(ROUND_STARTED:<room>:<node>:<user>)로 넣어, 로컬 pg_cron 이 00:01 KST 에 돌아도 중복 행이 생기지 않는다.
  insert into public.notifications (user_id, kind, title, body, room_id, node_id, actor_user_id, link, dedupe_key, created_at)
  select p.id, 'ROUND_STARTED', r.title || '의 2주차가 시작됐어요', r.title, r.id, n.id, null,
         '/my-study/spring', 'ROUND_STARTED:' || r.id || ':' || n.id || ':' || p.id, '2026-10-11 15:00:00+00'
  from public.profiles p, public.rooms r
  join public.goal_nodes n on n.room_id = r.id and n.depth = 2 and n.label = '2주차'
  where p.nickname = '철수' and r.slug = 'spring'
  on conflict (dedupe_key) do nothing;
  -- 조인이 비어(시드 드리프트) 0행이 들어가면 조용히 넘어가지 않는다. 재실행(이미 있음)은 통과
  get diagnostics v_n = row_count;
  if v_n = 0 and not exists (select 1 from public.notifications where dedupe_key like 'ROUND_STARTED:%' and user_id = (select id from public.profiles where nickname = '철수') and room_id = (select id from public.rooms where slug = 'spring')) then
    raise exception 'seed §4: 철수 spring ROUND_STARTED 알림이 0행 — 시드 데이터가 어긋났어요';
  end if;

  insert into public.notifications (user_id, kind, title, body, room_id, node_id, actor_user_id, link, dedupe_key, created_at)
  select p.id, 'SCHEDULE_CHANGED', r.title || ' 일정이 변경됐어요', null, r.id, null, a.id,
         '/my-study/aws', 'seed:SCHEDULE_CHANGED:cheolsu', '2026-10-12 01:30:00+00'
  from public.profiles p, public.rooms r, public.profiles a
  where p.nickname = '철수' and r.slug = 'aws' and a.nickname = '민수'
  on conflict (dedupe_key) do nothing;
  -- 조인이 비어(시드 드리프트) 0행이 들어가면 조용히 넘어가지 않는다. 재실행(이미 있음)은 통과
  get diagnostics v_n = row_count;
  if v_n = 0 and not exists (select 1 from public.notifications where dedupe_key = 'seed:SCHEDULE_CHANGED:cheolsu') then
    raise exception 'seed §4: 철수 SCHEDULE_CHANGED 알림이 0행 — 시드 데이터가 어긋났어요';
  end if;

  -- 지은의 EC2 제출(plan 03 시드 D) 에 링크 2개
  insert into public.submission_links (submission_id, url, sort_order)
  select s.id, x.url, x.ord
  from public.submissions s
  join public.goal_nodes n on n.id = s.node_id and n.title = 'EC2 인스턴스 유형 정리'
  join public.profiles p on p.id = s.user_id and p.nickname = '지은'
  cross join (values ('https://docs.aws.amazon.com/ec2/latest/instancetypes/', 0), ('https://github.com/jieun/aws-notes/blob/main/ec2.md', 1)) as x(url, ord)
  where not exists (select 1 from public.submission_links l where l.submission_id = s.id and l.url = x.url);

  get diagnostics v_n = row_count;
  if v_n = 0 and (select count(*) from public.submission_links l join public.submissions s on s.id = l.submission_id
                  join public.goal_nodes n on n.id = s.node_id and n.title = 'EC2 인스턴스 유형 정리'
                  join public.profiles p on p.id = s.user_id and p.nickname = '지은') <> 2 then
    raise exception 'seed §4: 지은의 EC2 제출 링크가 2개가 아니에요 — 시드 데이터가 어긋났어요';
  end if;
end $seed4$;

-- ═══════════ 고정 기준일 (항상 이 파일의 마지막 문장) ═══════════
-- kst_today() 가 로컬·E2E 에서 항상 2026-10-12 를 돌려주게 한다(02 §8). 호스팅에는 seed 가 가지 않는다.
-- (alter database … set app.today 는 Supabase 비 superuser postgres 역할에서 거부되어 internal.settings 에 둔다.)
insert into internal.settings (key, value) values ('today', '2026-10-12') on conflict (key) do update set value = excluded.value;
