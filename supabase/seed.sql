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

-- ═══════════ 고정 기준일 (항상 이 파일의 마지막 문장) ═══════════
-- kst_today() 가 로컬·E2E 에서 항상 2026-10-12 를 돌려주게 한다(02 §8). 호스팅에는 seed 가 가지 않는다.
-- (alter database … set app.today 는 Supabase 비 superuser postgres 역할에서 거부되어 internal.settings 에 둔다.)
insert into internal.settings (key, value) values ('today', '2026-10-12') on conflict (key) do update set value = excluded.value;
