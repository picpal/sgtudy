-- 0046_wrong_note.sql — 2026-10-23 오답노트(내 스터디 탭 · 내 과제 「오답노트」 보기). 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-23-wrong-answer-note-design.md (D1~D21 권장안).
-- 추가형: 표 1개(exam_practice, RPC 전용) + 인덱스 2개 + 공개 RPC 4개. 재정의 0개 — 0037 의 exam_reveal_ok·exam_grade·
--   exam_answer_shape_ok·exam_answer_canon·exam_is_answered·exam_viewer_member 를 호출만 한다.
-- 오답 = exam_submit 이 채점한 exam_answers.is_correct = false 행(미답 포함, D1). 노트 소속은 저장하지 않고 조인으로 유도한다.
-- 절: 1 스키마 · 2 내부 헬퍼 · 3 읽기 RPC(방·전체) · 4 다시 풀기 · 5 외웠어요 · 6 GRANT

-- ───────── 1. 스키마 (D6·D9) ─────────
create table public.exam_practice (
  user_id           uuid   not null references public.profiles(id) on delete cascade,
  question_id       bigint not null references public.exam_questions(id) on delete cascade,
  node_id           bigint not null references public.exams(node_id) on delete cascade,   -- 방별 집계용(문항의 node 와 같다, RPC 가 넣는다)
  last_correct      boolean,                  -- 마지막 연습 정오 (외웠어요만 눌렀으면 null)
  correct_count     int    not null default 0,
  wrong_count       int    not null default 0,
  last_answer       jsonb,                    -- 마지막 연습 답(canon, 미답 = JSON null)
  last_practiced_at timestamptz,
  mastered_at       timestamptz,              -- D8 「외웠어요」
  updated_at        timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index ix_exam_practice_user_node on public.exam_practice (user_id, node_id);
create index ix_exam_attempts_user on public.exam_attempts (user_id);   -- 목록이 user → attempts 로 들어간다(기존 unique 는 node_id 선행)

alter table public.exam_practice enable row level security;
revoke all on public.exam_practice from anon, authenticated;            -- 정책 없음 = RPC 전용

-- ───────── 2. 내부 헬퍼 (GRANT 없음) ─────────
-- 관문: 못 읽는 방·시험을 볼 수 없는 사람(exam_get 과 같은 자격 exam_viewer_member — PENDING 포함) = ROOM_NOT_FOUND.
-- PENDING 은 통과시키고 호출부가 분기한다(목록은 viewer:"pending", 연습·외움은 노트에 문항이 없으니 WRONG_NOTE_NOT_IN)
create or replace function public.wrong_note_room(p_slug text, p_uid uuid) returns public.rooms
language plpgsql stable security definer set search_path = '' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, p_uid) or not public.exam_viewer_member(r, p_uid) then
    perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요');
  end if;
  return r;
end $$;

-- 연습 기록 JSON. 한 번도 다시 풀지 않았으면(행 없음·외웠어요만 누름) null
create or replace function public.wrong_note_practice_json(p public.exam_practice) returns jsonb
language sql stable set search_path = '' as $$
  select case when p.last_practiced_at is null then null else
    jsonb_build_object('lastCorrect', p.last_correct, 'correctCount', p.correct_count, 'wrongCount', p.wrong_count,
                       'lastAnswer', p.last_answer, 'lastAt', public.iso(p.last_practiced_at)) end
$$;

-- 이 방에 발행된 시험(보관 제외)이 하나라도 있나 — 빈 상태 분기
create or replace function public.wrong_note_has_exam(p_room bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.exams x join public.goal_nodes n on n.id = x.node_id
                 where x.room_id = p_room and x.status = 'PUBLISHED' and n.archived_at is null)
$$;

-- 회차 안 순서: 회차 바로 아래부터 그 리프까지 조상 경로 [sort_order, id, …] (depth 순, me_tasks 의 ord 와 같은 기준). 배열 비교 = 깊이 우선
create or replace function public.wrong_note_ord(p_node bigint) returns bigint[]
language sql stable security definer set search_path = '' as $$
  with recursive up as (
    select g.id, g.parent_id, g.depth, g.sort_order from public.goal_nodes g where g.id = p_node
    union all
    select p.id, p.parent_id, p.depth, p.sort_order from public.goal_nodes p join up on p.id = up.parent_id where p.depth > 2)
  select array_agg(x order by u.depth, k) from up u, lateral (values (1, u.sort_order::bigint), (2, u.id)) v(k, x)
$$;

-- 회차별 내 오답(스펙 §4.2 rounds). 정답·해설 노출 규칙은 여기 한 곳 — 판정은 exam_reveal_ok 호출, 숨길 때는 키를 만들지 않는다.
-- 편집자 우회 없음(exam_view 의 v_edit 분기를 두지 않는다). 회차 = goal_nodes.round_id(0006 트리거가 보장하는 depth-2 조상)
create or replace function public.wrong_note_rounds(p_room bigint, p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rounds jsonb;
begin
  with mine as (
    select a, x, n, rn.id as root_id, rn.title as root_title, rn.sort_order as root_ord, public.wrong_note_ord(n.id) as leaf_ord,
           public.exam_reveal_ok(x, n, a) as open
    from public.exam_attempts a
    join public.exams x on x.node_id = a.node_id
    join public.goal_nodes n on n.id = a.node_id
    join public.goal_nodes rn on rn.id = n.round_id
    where a.user_id = p_uid and a.status = 'SUBMITTED' and x.room_id = p_room and n.archived_at is null),
  ex as (
    select m.root_id, m.root_title, m.root_ord, m.leaf_ord, (m.n).id as node_id, m.open,
      greatest((m.x).question_count - coalesce((m.a).correct_count, 0), 0) as locked_count,
      jsonb_build_object('nodeId', (m.n).id::text, 'title', (m.n).title, 'endDate', to_char((m.n).end_date, 'YYYY-MM-DD'),
        'reveal', lower((m.x).reveal), 'score', (m.a).score, 'maxScore', (m.a).max_score, 'correctCount', (m.a).correct_count,
        'questionCount', (m.x).question_count, 'locked', not m.open)
      || case when m.open then jsonb_build_object('items', (
             select coalesce(jsonb_agg(jsonb_build_object(
               'question', jsonb_build_object('id', q.id::text, 'ord', q.ord, 'type', lower(q.qtype), 'prompt', q.prompt_md,
                                              'choices', q.choices, 'points', q.points, 'answer', q.answer, 'explanation', q.explanation_md),
               'no', q.ord + 1, 'mine', e.answer, 'practice', public.wrong_note_practice_json(p), 'mastered', p.mastered_at is not null)
               order by q.ord), '[]'::jsonb)
             from public.exam_answers e
             join public.exam_questions q on q.id = e.question_id
             left join public.exam_practice p on p.user_id = p_uid and p.question_id = q.id
             where e.attempt_id = (m.a).id and e.is_correct = false))
         else jsonb_build_object('lockedCount', greatest((m.x).question_count - coalesce((m.a).correct_count, 0), 0),
                                 'unlockDate', to_char((m.n).end_date, 'YYYY-MM-DD')) end as j
    from mine m)
  select coalesce(jsonb_agg(jsonb_build_object('id', g.root_id::text, 'title', g.root_title, 'exams', g.exams)
                  order by g.root_ord, g.root_id), '[]'::jsonb)
  into v_rounds
  from (select root_id, root_title, root_ord, jsonb_agg(j order by leaf_ord, node_id) as exams
        from ex
        -- 만점 시험·오답 없는 잠긴 시험은 뺀다 → 그런 시험만 있는 회차도 빠진다
        where (open and jsonb_array_length(j -> 'items') > 0) or (not open and locked_count > 0)
        group by root_id, root_title, root_ord) g;
  return v_rounds;
end $$;

-- 머리줄 합계(목록 응답의 초기값 — 화면의 정본은 클라이언트 totalsOf, D21). rounds 를 그대로 세어 목록과 어긋날 수 없게 한다.
-- wrong = 공개된 오답(외운 것 포함) · retriedOk = 그중 마지막 연습이 맞힘 · mastered = 외움 · locked = 잠긴 시험 lockedCount 합
create or replace function public.wrong_note_totals(p_rounds jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'wrong',     count(it.v),
    'retriedOk', count(it.v) filter (where (it.v #>> '{practice,lastCorrect}')::boolean),
    'mastered',  count(it.v) filter (where (it.v ->> 'mastered')::boolean),
    'locked',    coalesce((select sum((e2.v ->> 'lockedCount')::int)
                           from jsonb_array_elements(coalesce(p_rounds, '[]'::jsonb)) r2(v), jsonb_array_elements(r2.v -> 'exams') e2(v)
                           where (e2.v ->> 'locked')::boolean), 0))
  from jsonb_array_elements(coalesce(p_rounds, '[]'::jsonb)) r(v)
  cross join lateral jsonb_array_elements(r.v -> 'exams') e(v)
  left join lateral jsonb_array_elements(coalesce(e.v -> 'items', '[]'::jsonb)) it(v) on true
$$;

-- ───────── 3. 읽기 RPC ─────────
-- 방 탭(스펙 §4.2). 관문 뒤 내부 함수 세 개를 부르는 껍데기
create or replace function public.wrong_note_list(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; v_rounds jsonb;
begin
  r := public.wrong_note_room(p_slug, v_uid);
  -- 승인 대기(PENDING): 내용 없음(공지 D10 과 같은 판단)
  if r.leader_id <> v_uid and exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = v_uid and m.status = 'PENDING') then
    return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'viewer', 'pending', 'hasExam', false,
                              'totals', public.wrong_note_totals('[]'::jsonb), 'rounds', '[]'::jsonb);
  end if;
  v_rounds := public.wrong_note_rounds(r.id, v_uid);
  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'viewer', 'member',
    'hasExam', public.wrong_note_has_exam(r.id), 'totals', public.wrong_note_totals(v_rounds), 'rounds', v_rounds);
end $$;

-- 내 과제 「오답노트」 보기(D18) — 내 방 전부. 자격 = 그룹장 · ACTIVE · INACTIVE 멤버(PENDING·보관 제외, DRAFT 는 그룹장만 — me_tasks 와 같다).
-- tone·status·순서(방 id 순)는 me_tasks.studies 와 같은 식 — /tasks 스터디 칩·과제 보기 섹션 순서와 맞춘다. 방마다 wrong_note_list 와 같은 내부 함수
create or replace function public.wrong_note_mine() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.require_user();
begin
  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'studies', (select coalesce(jsonb_agg(jsonb_build_object(
                  'slug', s.slug, 'title', s.title,
                  'tone', (array['mint', 'blue', 'peach', 'lav', 'amber', 'slate'])[1 + (s.id % 6)],
                  'status', lower(s.status),
                  'hasExam', public.wrong_note_has_exam(s.id), 'totals', public.wrong_note_totals(s.rounds), 'rounds', s.rounds)
                  order by s.id), '[]'::jsonb)
                from (select r.id, r.slug, r.title, r.status, public.wrong_note_rounds(r.id, v_uid) as rounds
                      from public.rooms r
                      where r.archived_at is null
                        and (r.status <> 'DRAFT' or r.leader_id = v_uid)
                        and (r.leader_id = v_uid or exists (
                          select 1 from public.room_members m where m.room_id = r.id and m.user_id = v_uid and m.status in ('ACTIVE', 'INACTIVE')))) s));
end $$;

-- ───────── 4. 다시 풀기 (D6·D7·D14) ─────────
-- 연습 대상 관문(스펙 §4.3 1~3): 이 방 시험의 문항(NODE_NOT_FOUND) → 내 제출 응시·보관 아닌 리프(WRONG_NOTE_NOT_IN —
-- 남의 것·미제출·PENDING, 존재 숨김) → 정답 공개(exam_reveal_ok, WRONG_NOTE_LOCKED) → 틀린 문항(WRONG_NOTE_NOT_IN).
-- 공개 판정을 정오보다 먼저 — 잠긴 시험에서 맞힌 문항(NOT_IN)·틀린 문항(LOCKED)이 다른 코드를 내면 공개 전 문항별 정오가 샌다(D3·D4)
create or replace function public.wrong_note_target(p_room bigint, p_uid uuid, p_question bigint,
  out q public.exam_questions, out x public.exams, out n public.goal_nodes, out a public.exam_attempts)
language plpgsql stable security definer set search_path = '' as $$
begin
  select * into q from public.exam_questions where id = p_question;
  if found then select * into x from public.exams where node_id = q.node_id and room_id = p_room; end if;
  if q.id is null or x.node_id is null then
    perform public.fail('NODE_NOT_FOUND', '문항을 찾을 수 없어요', jsonb_build_object('questionId', p_question::text));
  end if;
  select * into n from public.goal_nodes where id = x.node_id;
  select * into a from public.exam_attempts where node_id = x.node_id and user_id = p_uid and status = 'SUBMITTED';
  if a.id is null or n.archived_at is not null then
    perform public.fail('WRONG_NOTE_NOT_IN', '오답노트에 없는 문항이에요', jsonb_build_object('questionId', p_question::text));
  end if;
  if not public.exam_reveal_ok(x, n, a) then
    perform public.fail('WRONG_NOTE_LOCKED', '정답이 공개된 뒤에 다시 풀 수 있어요', jsonb_build_object('unlockDate', to_char(n.end_date, 'YYYY-MM-DD')));
  end if;
  if not exists (select 1 from public.exam_answers e where e.attempt_id = a.id and e.question_id = q.id and e.is_correct = false) then
    perform public.fail('WRONG_NOTE_NOT_IN', '오답노트에 없는 문항이에요', jsonb_build_object('questionId', p_question::text));
  end if;
end $$;

-- 입력 [{questionId: "123", answer: jsonb}] 1~50개. 채점은 exam_grade 하나(공식 채점과 같은 규칙), 기록은 exam_practice 에만 —
-- exam_attempts·exam_answers·submissions·exams 에는 쓰지 않는다. 한 문장(트랜잭션) — 하나라도 실패하면 전부 롤백.
-- 응답 = 문항별 정오 + 갱신된 연습 행(정답·해설·합계 없음 — 목록에 있고 합계는 클라이언트, D14·D21)
create or replace function public.wrong_note_practice(p_slug text, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_now timestamptz := public.app_now();
  r     public.rooms;
  it    jsonb;
  t     record;
  v_ans jsonb;
  v_c   boolean;
  p     public.exam_practice;
  v_res jsonb := '{}'::jsonb;
begin
  r := public.wrong_note_room(p_slug, v_uid);
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) not between 1 and 50 then
    perform public.fail('VALIDATION_FAILED', '한 번에 1~50문항을 채점할 수 있어요', '{"field":"answers"}'::jsonb);
  end if;
  -- 같은 문항이 두 번이면 카운트가 두 번 오르고 응답 키가 겹친다 — 거절
  if (select count(distinct e ->> 'questionId') from jsonb_array_elements(p_answers) e) <> jsonb_array_length(p_answers) then
    perform public.fail('VALIDATION_FAILED', '같은 문항이 두 번 들어 있어요', '{"field":"answers"}'::jsonb);
  end if;
  for it in select * from jsonb_array_elements(p_answers) loop
    if jsonb_typeof(it) <> 'object' or coalesce(jsonb_typeof(it -> 'questionId'), '') <> 'string' or (it ->> 'questionId') !~ '^[0-9]{1,18}$' then
      perform public.fail('VALIDATION_FAILED', '문항 id 가 올바르지 않아요', '{"field":"questionId"}'::jsonb);
    end if;
    select * into t from public.wrong_note_target(r.id, v_uid, (it ->> 'questionId')::bigint);
    v_ans := coalesce(it -> 'answer', 'null'::jsonb);
    -- 빈 답은 오답으로 채점(공식 채점과 같다). 답했는데 모양이 틀리면 거절
    if public.exam_is_answered(v_ans) and not public.exam_answer_shape_ok(t.q, v_ans) then
      perform public.fail('VALIDATION_FAILED', '답을 확인해 주세요', jsonb_build_object('questionId', it ->> 'questionId'));
    end if;
    select g.correct into v_c from public.exam_grade(t.q, v_ans) g;
    insert into public.exam_practice as ep (user_id, question_id, node_id, last_correct, correct_count, wrong_count, last_answer, last_practiced_at, updated_at)
    values (v_uid, (t.q).id, (t.q).node_id, v_c, case when v_c then 1 else 0 end, case when v_c then 0 else 1 end,
            case when public.exam_is_answered(v_ans) then public.exam_answer_canon(t.q, v_ans) else 'null'::jsonb end, v_now, v_now)
    on conflict (user_id, question_id) do update set
      last_correct = excluded.last_correct,
      correct_count = ep.correct_count + excluded.correct_count,
      wrong_count = ep.wrong_count + excluded.wrong_count,
      last_answer = excluded.last_answer,
      last_practiced_at = excluded.last_practiced_at,
      updated_at = excluded.updated_at                                   -- mastered_at 은 그대로(D8 — 되돌리기는 사용자가)
    returning * into p;
    v_res := v_res || jsonb_build_object((t.q).id::text, jsonb_build_object('correct', v_c, 'practice', public.wrong_note_practice_json(p)));
  end loop;
  return jsonb_build_object('results', v_res);
end $$;

-- ───────── 5. 외웠어요 (D8) ─────────
-- 다시 풀기와 같은 관문(노트에 있고 공개된 문항만 — 잠긴 시험은 외울 수도 없다). 행이 없으면 만든다(카운트 0)
create or replace function public.wrong_note_master(p_slug text, p_question bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  v_now timestamptz := public.app_now();
  r     public.rooms;
  t     record;
  p     public.exam_practice;
begin
  r := public.wrong_note_room(p_slug, v_uid);
  if p_on is null then perform public.fail('VALIDATION_FAILED', '켜기·끄기를 정해 주세요', '{"field":"on"}'::jsonb); end if;
  select * into t from public.wrong_note_target(r.id, v_uid, p_question);
  insert into public.exam_practice as ep (user_id, question_id, node_id, mastered_at, updated_at)
  values (v_uid, (t.q).id, (t.q).node_id, case when p_on then v_now end, v_now)
  on conflict (user_id, question_id) do update set mastered_at = excluded.mastered_at, updated_at = excluded.updated_at
  returning * into p;
  return jsonb_build_object('mastered', p.mastered_at is not null);
end $$;

-- ───────── 6. GRANT (공개 RPC 4개만 — wrong_note_* 헬퍼는 GRANT 없음) ─────────
grant execute on function public.wrong_note_list(text)                   to authenticated;
grant execute on function public.wrong_note_mine()                       to authenticated;
grant execute on function public.wrong_note_practice(text, jsonb)        to authenticated;
grant execute on function public.wrong_note_master(text, bigint, boolean) to authenticated;
