-- 0053_exam_answer_reveals.sql — 2026-10-29 시험 정답 노출 형식 검증(.claude/skills/verify-formal-exam-answer-exposure) 발견 F1·F3 수정. 배포 후 수정 금지.
-- F1(P1): after_deadline 마감 뒤 정답 키를 받은 담당자가, 편집자의 종료일 연장(node_update)·공개 시점 변경(exam_put)으로
--   exam_closed 가 다시 거짓이 되면 응시해 점수를 받았다. → 정답 키를 내준 사실을 exam_answer_reveals 에 남기고(exam_view),
--   응시 관문 exam_target(답 저장·제출 공용)이 그 기록이 있으면 EXAM_ANSWERS_SEEN 으로 거부한다. 편집자의 연장·공개 시점 변경은 막지 않는다.
--   오답노트(wrong_note_rounds)는 제출한 응시만 열리고(그 뒤 응시 불가), 라우트가 채운 AI 캐시는 정답 문맥을 담지 않는다(P3) → 기록하지 않는다.
-- F3(P5): ai_explain_begin 의 응시 중 잠금이 마감일(v_today <= end_date)까지만 걸려, after_submit 지각 응시 중엔 AI 해설이 열렸다.
--   → 날짜 조건을 빼고 "IN_PROGRESS + 마지막 활동 3시간 안" 만으로 판정(스펙 D16 결정 표).
-- 추가형: 표 1개(exam_answer_reveals, RPC 전용) + 재정의 3개(exam_target · exam_view(stable → volatile) · ai_explain_begin, 시그니처 동일 → GRANT 유지).
-- 이미 정답을 본 사람의 과거 열람은 기록이 없어 소급하지 않는다(이 마이그레이션 뒤 열람부터).

-- ───────── 1. 스키마 ─────────
create table public.exam_answer_reveals (
  node_id     bigint not null references public.exams(node_id) on delete cascade,
  user_id     uuid   not null references public.profiles(id) on delete cascade,
  revealed_at timestamptz not null default now(),
  primary key (node_id, user_id)
);

alter table public.exam_answer_reveals enable row level security;
revoke all on public.exam_answer_reveals from anon, authenticated;   -- 정책 없음 = RPC 전용

-- ───────── 2. exam_target (0037 원문 + 정답 열람 거부) ─────────
create or replace function public.exam_target(p_node bigint, p_uid uuid) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare n public.goal_nodes; x public.exams;
begin
  n := public.submission_target(p_node, p_uid);
  select * into x from public.exams where node_id = n.id;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', n.id::text)); end if;
  if x.status <> 'PUBLISHED' then perform public.fail('EXAM_NOT_PUBLISHED', '아직 발행되지 않은 시험이에요', jsonb_build_object('nodeId', n.id::text)); end if;
  if public.kst_today() < n.start_date then
    perform public.fail('TASK_NOT_STARTED', '아직 시작되지 않은 시험이에요', jsonb_build_object('startDate', to_char(n.start_date, 'YYYY-MM-DD')));
  end if;
  if public.exam_closed(x, n) then
    perform public.fail('EXAM_CLOSED', '마감이 지나 해설이 공개된 시험은 제출할 수 없어요', jsonb_build_object('endDate', to_char(n.end_date, 'YYYY-MM-DD')));
  end if;
  -- 정답 키를 한 번이라도 받았으면(exam_view 가 기록) 기간 연장·공개 시점 변경으로 다시 열려도 응시 불가(F1)
  if exists (select 1 from public.exam_answer_reveals v where v.node_id = n.id and v.user_id = p_uid) then
    perform public.fail('EXAM_ANSWERS_SEEN', '정답·해설을 이미 본 시험은 응시할 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  return n;
end $$;

-- ───────── 3. exam_view (0037 원문 + volatile · reason answers_seen · 정답 키 기록) ─────────
create or replace function public.exam_view(p_node bigint, p_uid uuid, p_for uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  x        public.exams;
  n        public.goal_nodes;
  r        public.rooms;
  a        public.exam_attempts;
  v_edit   boolean;
  v_asg    boolean;
  v_member boolean;
  v_reveal boolean;
  v_reason text;
  v_qs     jsonb;
  v_att    jsonb;
  v_sub    int;
  v_all    int;
begin
  select * into x from public.exams where node_id = p_node;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', p_node::text)); end if;
  select * into n from public.goal_nodes where id = p_node;
  select * into r from public.rooms where id = n.room_id;
  v_edit := coalesce(public.can_edit_curriculum(r, p_uid), false);
  v_member := public.exam_viewer_member(r, p_uid);
  -- 비멤버·익명: 공개 방이라도 시험은 비공개(존재 숨김)
  if not v_edit and not v_member then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', p_node::text)); end if;
  if p_for is distinct from p_uid and not v_edit then perform public.fail('FORBIDDEN', '다른 사람의 답안은 편집자만 볼 수 있어요'); end if;

  -- viewer 의 담당·사유는 응시 행 주인(p_for) 기준 — 편집자가 남의 답안을 볼 때 두 사람 상태가 섞이지 않게(exam_attempt_get).
  -- canTake 는 자기 응시에서만 참(편집자가 남 대신 풀 수 없다)
  v_asg := p_for is not null and public.is_task_assignee(n.id, p_for);
  select * into a from public.exam_attempts where node_id = p_node and user_id = p_for;
  select count(*)::int, count(*) filter (where s.status = 'SUBMITTED')::int into v_all, v_sub
  from public.exam_attempts s where s.node_id = p_node;
  v_reveal := v_edit or public.exam_reveal_ok(x, n, a);

  v_reason := case
    when a.status = 'SUBMITTED' then 'submitted'
    when r.status <> 'ACTIVE' or r.archived_at is not null then 'room_not_active'
    when n.archived_at is not null then 'archived'
    when not v_asg then 'not_assignee'
    when x.status <> 'PUBLISHED' then 'not_published'
    when public.kst_today() < n.start_date then 'not_started'
    when public.exam_closed(x, n) then 'closed'                      -- after_deadline 마감 뒤: 정답이 열려 응시 불가
    when exists (select 1 from public.exam_answer_reveals v where v.node_id = p_node and v.user_id = p_for) then 'answers_seen'   -- 정답을 받은 뒤 다시 열림
    else null end;

  -- 문항: 편집자 | 담당자(스펙 §3.4 — 담당 아닌 멤버는 요약만). 담당자에게도 초안·시작 전에는 문항을 싣지 않는다
  -- (시작일 전 문제 유출 방지 — 화면은 reason 으로 안내만). 정답·해설 키는 v_reveal 일 때만 만든다
  if v_edit or (v_asg and x.status = 'PUBLISHED' and public.kst_today() >= n.start_date) then
    select coalesce(jsonb_agg(
      jsonb_build_object('id', q.id::text, 'ord', q.ord, 'type', lower(q.qtype), 'prompt', q.prompt_md, 'choices', q.choices, 'points', q.points)
      || case when v_reveal then jsonb_build_object('answer', q.answer, 'explanation', q.explanation_md) else '{}'::jsonb end
      order by q.ord), '[]'::jsonb)
    into v_qs from public.exam_questions q where q.node_id = p_node;
    -- 정답 키를 내준 사실을 남긴다(본인 열람 · 편집자 아님 · 아직 제출 전). 제출 뒤엔 saveOnce·submitOnce 가 막으니 남기지 않는다
    if v_reveal and not v_edit and p_for = p_uid and a.status is distinct from 'SUBMITTED' then
      insert into public.exam_answer_reveals (node_id, user_id) values (p_node, p_uid) on conflict do nothing;
    end if;
  end if;

  if a.id is not null then
    v_att := jsonb_build_object(
      'status', lower(a.status),
      'answers', coalesce((select jsonb_object_agg(e.question_id::text, e.answer) from public.exam_answers e where e.attempt_id = a.id), '{}'::jsonb),
      'score', a.score, 'maxScore', a.max_score, 'correctCount', a.correct_count,
      'submittedAt', public.iso(a.submitted_at),
      'isLate', (select s.is_late from public.submissions s where s.node_id = p_node and s.user_id = p_for),
      -- 정오는 공개 조건 + 제출 뒤에만(after_deadline 마감 전엔 점수만 — 스펙 §5.1 results null)
      'results', case when v_reveal and a.status = 'SUBMITTED' then
        coalesce((select jsonb_object_agg(e.question_id::text, jsonb_build_object('correct', e.is_correct, 'earned', e.earned))
                  from public.exam_answers e where e.attempt_id = a.id), '{}'::jsonb) end);
  end if;

  return jsonb_build_object(
    'today', to_char(public.kst_today(), 'YYYY-MM-DD'),
    'node', jsonb_build_object('id', n.id::text, 'title', n.title, 'startDate', to_char(n.start_date, 'YYYY-MM-DD'),
                               'endDate', to_char(n.end_date, 'YYYY-MM-DD'), 'archived', n.archived_at is not null),
    -- 초안은 편집자가 아니면 상태만(문항 수·배점·공개 시점도 싣지 않는다 — exam_summary 와 같은 규칙)
    'exam', case when v_edit or x.status = 'PUBLISHED' then
              jsonb_build_object('status', lower(x.status), 'reveal', lower(x.reveal), 'questionCount', x.question_count,
                                 'totalPoints', x.total_points, 'publishedAt', public.iso(x.published_at),
                                 'closed', public.exam_closed(x, n))
            else jsonb_build_object('status', lower(x.status), 'publishedAt', null, 'closed', false) end
            -- 편집자 전용 키. locked = 응시 행 1건~(진행 중 포함, exam_assert_unlocked 와 같은 규칙) · submittedCount = 제출만
            || case when v_edit then jsonb_build_object('source', lower(x.source), 'locked', v_all > 0, 'submittedCount', v_sub, 'brief', x.brief) else '{}'::jsonb end,
    'viewer', jsonb_build_object('canEdit', v_edit, 'isAssignee', v_asg,
                                 'canTake', v_reason is null and p_for is not distinct from p_uid, 'reason', v_reason),
    'questions', v_qs,
    'attempt', v_att);
end $$;

-- ───────── 4. ai_explain_begin (0052 원문 − 마감일 조건) ─────────
create or replace function public.ai_explain_begin(p_slug text, p_term_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  v_now   timestamptz := public.app_now();
  r       public.rooms;
  c       public.ai_explain_cache;
  v_turn  jsonb;
  v_round jsonb;
  v_tags  jsonb;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then
    perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요');
  end if;
  if r.leader_id <> v_uid and not exists (
       select 1 from public.room_members m where m.room_id = r.id and m.user_id = v_uid and m.status in ('ACTIVE', 'INACTIVE')) then
    perform public.fail('NOT_MEMBER', '참가가 승인되면 쓸 수 있어요');
  end if;
  if p_term_key is null or p_term_key !~ '^[0-9a-f]{64}$' then
    perform public.fail('VALIDATION_FAILED', '용어를 다시 선택해 주세요', '{"field":"term"}'::jsonb);
  end if;
  if exists (
       select 1 from public.exam_attempts a
       join public.exams x on x.node_id = a.node_id
       join public.goal_nodes n on n.id = a.node_id
       where a.user_id = v_uid and a.status = 'IN_PROGRESS' and x.room_id = r.id and x.status = 'PUBLISHED'
         and n.archived_at is null
         -- 마감 전후 무관(after_submit 지각 응시 포함, F3). 마지막 활동(시작·답 저장) 3시간 안만 — 답 하나 저장하고 방치하면 마감까지 방 전체가 잠기던 것을 막는다. 다시 답을 저장하면 다시 잠긴다
         and greatest(a.started_at, (select max(s.saved_at) from public.exam_answers s where s.attempt_id = a.id)) > v_now - interval '3 hours') then
    perform public.fail('EXAM_IN_PROGRESS', '시험을 제출한 뒤에 쓸 수 있어요');
  end if;

  select * into c from public.ai_explain_cache ec
   where ec.room_id = r.id and ec.term_key = p_term_key and ec.created_at > v_now - interval '30 days';
  if found then
    update public.ai_explain_cache set hits = hits + 1, last_hit_at = v_now
     where room_id = r.id and term_key = p_term_key;
    return jsonb_build_object('hit', true, 'body', c.body);
  end if;

  v_turn := public.ai_turn_check('term_explain', false);

  select coalesce(jsonb_agg(t.label order by rt.sort_order, t.slug), '[]'::jsonb) into v_tags
  from public.room_tags rt join public.tags t on t.slug = rt.tag_slug where rt.room_id = r.id;
  select jsonb_build_object('label', coalesce(n.label, ''), 'title', n.title, 'goal', left(n.description_md, 300)) into v_round
  from public.goal_nodes n where n.id = public.room_current_round_id(r.id, v_today);

  return jsonb_build_object('hit', false, 'id', (v_turn ->> 'id')::bigint, 'room', jsonb_build_object(
    'title', r.title, 'intro', r.intro, 'description', left(r.description_md, 600), 'tags', v_tags, 'round', v_round));
end $$;
