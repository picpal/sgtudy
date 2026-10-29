-- 0054_exam_reveal_unsubmitted.sql — 2026-10-29 사용자 결정: 시험 정답·해설은 제출한 사람(과 편집자)만 본다. 배포 후 수정 금지.
-- 1) 기본: 미제출자는 마감이 지나도 정답을 받지 않는다. reveal(after_submit|after_deadline)은 "제출자에게 언제 보여 주나"만 뜻한다.
--    after_deadline 마감 뒤 응시 불가(exam_closed · EXAM_CLOSED)는 그대로 — 지각 응시 허용은 이 결정 범위 밖.
-- 2) 편집자 옵션 exams.reveal_unsubmitted(기본 false): 켜면 마감 뒤 미제출 담당자가 [정답·해설 보기](exam_answers_open)로 직접 연다.
--    여는 순간 exam_answer_reveals 에 남는다(0053 표 재사용 — 0053 이후 기록 유지). exam_view 는 그 행이 있을 때만 미제출자에게 정답 키를 싣는다.
-- 3) 정답을 본 뒤 응시는 막지 않는다(0053 EXAM_ANSWERS_SEEN 삭제) — exam_answer_reveals 행이 있는 응시 = 「정답 본 뒤 응시」 표시
--    (exam_view viewer.answersSeen · exam_results members[].answersSeen). 점수 집계는 그대로, 문항별 정답률에서는 뺀다(answersSeenExcluded).
-- 추가형: 열 1개 + 함수 3개(exam_absent_reveal_open · exam_reveal_for · exam_answers_open · exam_reveal_unsubmitted_set 은 RPC)
--   + 재정의 5개(exam_reveal_ok ←0037 · exam_target ←0053 · exam_view ←0053 · exam_results ←0037 · comment_exam_locked ←0041, 시그니처 동일 → GRANT 유지).
-- 오답노트(wrong_note_rounds·wrong_note_target)는 exam_reveal_ok 를 부르고 제출한 응시만 다루므로 재정의하지 않는다.
-- 운영 영향: 이미 after_deadline 마감이 지난 시험의 미제출자는 이 배포 뒤 정답·해설을 못 보게 된다(옵션 기본 꺼짐).

-- ───────── 1. 스키마 ─────────
alter table public.exams add column reveal_unsubmitted boolean not null default false;

-- ───────── 2. 판정식 ─────────
-- 제출자 공개(0037 판의 제출자 쪽만). after_submit = 제출 즉시 · after_deadline = 오늘 기준 마감 뒤(연장하면 다시 닫힘). 미제출 = 항상 거짓
create or replace function public.exam_reveal_ok(x public.exams, n public.goal_nodes, a public.exam_attempts) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(a.status = 'SUBMITTED' and case x.reveal
    when 'AFTER_SUBMIT'   then true
    when 'AFTER_DEADLINE' then public.kst_today() > n.end_date
    else false end, false)
$$;

-- 미제출자가 [정답·해설 보기]를 누를 수 있나 = 발행 · 옵션 켬 · 오늘 기준 마감 뒤(연장하면 다시 닫힘)
create or replace function public.exam_absent_reveal_open(x public.exams, n public.goal_nodes) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(x.status = 'PUBLISHED' and x.reveal_unsubmitted and public.kst_today() > n.end_date, false)
$$;

-- 일반 멤버 p_uid 에게 정답·해설을 여나(exam_view · comment_exam_locked 공용). 미제출자는 열 수 있고 + 스스로 연 기록이 있을 때만
create or replace function public.exam_reveal_for(x public.exams, n public.goal_nodes, a public.exam_attempts, p_uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.exam_reveal_ok(x, n, a)
      or (a.status is distinct from 'SUBMITTED' and public.exam_absent_reveal_open(x, n)
          and exists (select 1 from public.exam_answer_reveals v where v.node_id = n.id and v.user_id = p_uid))
$$;

-- ───────── 3. exam_target (0053 원문 − EXAM_ANSWERS_SEEN) ─────────
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
    perform public.fail('EXAM_CLOSED', '마감이 지나 제출할 수 없는 시험이에요', jsonb_build_object('endDate', to_char(n.end_date, 'YYYY-MM-DD')));
  end if;
  -- 정답을 본 뒤 응시는 막지 않는다 — exam_answer_reveals 행이 결과에 「정답 본 뒤 응시」로 남는다(0054)
  return n;
end $$;

-- ───────── 4. exam_view (0053 원문 + exam_reveal_for · reason answers_seen 삭제 · answersSeen·canOpenAnswers · revealUnsubmitted) ─────────
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
  v_seen   boolean;
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
  v_reveal := v_edit or public.exam_reveal_for(x, n, a, p_for);
  v_seen := exists (select 1 from public.exam_answer_reveals v where v.node_id = p_node and v.user_id = p_for);

  v_reason := case
    when a.status = 'SUBMITTED' then 'submitted'
    when r.status <> 'ACTIVE' or r.archived_at is not null then 'room_not_active'
    when n.archived_at is not null then 'archived'
    when not v_asg then 'not_assignee'
    when x.status <> 'PUBLISHED' then 'not_published'
    when public.kst_today() < n.start_date then 'not_started'
    when public.exam_closed(x, n) then 'closed'                      -- after_deadline 마감 뒤: 응시 불가(정답은 제출자에게만)
    else null end;

  -- 문항: 편집자 | 담당자(스펙 §3.4 — 담당 아닌 멤버는 요약만). 담당자에게도 초안·시작 전에는 문항을 싣지 않는다
  -- (시작일 전 문제 유출 방지 — 화면은 reason 으로 안내만). 정답·해설 키는 v_reveal 일 때만 만든다
  if v_edit or (v_asg and x.status = 'PUBLISHED' and public.kst_today() >= n.start_date) then
    select coalesce(jsonb_agg(
      jsonb_build_object('id', q.id::text, 'ord', q.ord, 'type', lower(q.qtype), 'prompt', q.prompt_md, 'choices', q.choices, 'points', q.points)
      || case when v_reveal then jsonb_build_object('answer', q.answer, 'explanation', q.explanation_md) else '{}'::jsonb end
      order by q.ord), '[]'::jsonb)
    into v_qs from public.exam_questions q where q.node_id = p_node;
    -- 정답 키를 내준 사실을 남긴다(본인 열람 · 편집자 아님 · 아직 제출 전). 지금은 exam_answers_open 이 먼저 남긴 행이 있을 때만 여기 오지만,
    -- 판정식이 바뀌어도 「표시 없이 정답을 본 응시」가 생기지 않게 둔다
    if v_reveal and not v_edit and p_for = p_uid and a.status is distinct from 'SUBMITTED' then
      insert into public.exam_answer_reveals (node_id, user_id) values (p_node, p_uid) on conflict do nothing;
      v_seen := true;
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
              jsonb_build_object('status', lower(x.status), 'reveal', lower(x.reveal), 'revealUnsubmitted', x.reveal_unsubmitted,
                                 'questionCount', x.question_count, 'totalPoints', x.total_points, 'publishedAt', public.iso(x.published_at),
                                 'closed', public.exam_closed(x, n))
            else jsonb_build_object('status', lower(x.status), 'publishedAt', null, 'closed', false) end
            -- 편집자 전용 키. locked = 응시 행 1건~(진행 중 포함, exam_assert_unlocked 와 같은 규칙) · submittedCount = 제출만
            || case when v_edit then jsonb_build_object('source', lower(x.source), 'locked', v_all > 0, 'submittedCount', v_sub, 'brief', x.brief) else '{}'::jsonb end,
    -- answersSeen = p_for 가 제출 전에 정답·해설을 본 기록(그 뒤 응시 = 「정답 본 뒤 응시」).
    -- canOpenAnswers = 본인 · 편집자 아님 · 담당 · 미제출 · 아직 안 열었고 옵션으로 열 수 있음 → [정답·해설 보기]
    'viewer', jsonb_build_object('canEdit', v_edit, 'isAssignee', v_asg,
                                 'canTake', v_reason is null and p_for is not distinct from p_uid, 'reason', v_reason,
                                 'answersSeen', v_seen,
                                 'canOpenAnswers', not v_edit and v_asg and p_for is not distinct from p_uid and not v_seen
                                                   and a.status is distinct from 'SUBMITTED' and n.archived_at is null
                                                   and public.exam_absent_reveal_open(x, n)),
    'questions', v_qs,
    'attempt', v_att);
end $$;

-- ───────── 5. 미제출자 [정답·해설 보기] ─────────
-- 담당 · 미제출 · exam_absent_reveal_open 이면 exam_answer_reveals 에 남기고 정답이 실린 exam_view 를 돌려준다. 이미 열었으면 그대로
create or replace function public.exam_answers_open(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  r     public.rooms;
  n     public.goal_nodes;
  x     public.exams;
  a     public.exam_attempts;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  select * into n from public.goal_nodes where id = p_node and room_id = r.id;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  select * into x from public.exams where node_id = n.id;
  if not found or not public.exam_viewer_member(r, v_uid) then
    perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', n.id::text));
  end if;
  if not public.is_task_assignee(n.id, v_uid) then perform public.fail('TASK_NOT_ASSIGNED', '담당 과제가 아니에요', jsonb_build_object('nodeId', n.id::text)); end if;
  if n.archived_at is not null then perform public.fail('TASK_ARCHIVED', '보관된 과제예요', jsonb_build_object('nodeId', n.id::text)); end if;
  select * into a from public.exam_attempts where node_id = n.id and user_id = v_uid;
  if a.status is distinct from 'SUBMITTED' then
    if not public.exam_absent_reveal_open(x, n) then
      perform public.fail('EXAM_ANSWERS_CLOSED', '아직 정답·해설을 볼 수 없어요', jsonb_build_object('nodeId', n.id::text));
    end if;
    insert into public.exam_answer_reveals (node_id, user_id) values (n.id, v_uid) on conflict do nothing;
  end if;
  return public.exam_view(n.id, v_uid, v_uid);
end $$;

-- 편집자 옵션 「미응시자에게도 정답 공개」. 응시가 있어도 바꿀 수 있다(공개 시점처럼 잠금 대상 아님). 끄면 연 사람도 다시 못 본다(기록·표시는 남음)
create or replace function public.exam_reveal_unsubmitted_set(p_slug text, p_node bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v record; v_uid uuid := public.current_user_id();
begin
  select * into v from public.exam_editable_leaf(p_slug, p_node);   -- 방 잠금·편집자·리프·보관 아님
  if p_on is null then perform public.fail('VALIDATION_FAILED', '켜기·끄기를 골라 주세요', '{"field":"revealUnsubmitted"}'::jsonb); end if;
  update public.exams set reveal_unsubmitted = p_on, updated_at = now() where node_id = (v.n).id;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', (v.n).id::text)); end if;
  return public.exam_view((v.n).id, v_uid, v_uid);
end $$;

grant execute on function public.exam_answers_open(text, bigint)                    to authenticated;
grant execute on function public.exam_reveal_unsubmitted_set(text, bigint, boolean) to authenticated;

-- ───────── 6. exam_results (0037 원문 + answersSeen · 정답률에서 정답 본 뒤 응시 제외 · answersSeenExcluded) ─────────
create or replace function public.exam_results(p_slug text, p_node bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  r     public.rooms;
  n     public.goal_nodes;
  x     public.exams;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  perform public.require_curriculum_editor(r, v_uid);
  select * into n from public.goal_nodes where id = p_node and room_id = r.id;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  select * into x from public.exams where node_id = n.id;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', n.id::text)); end if;

  return jsonb_build_object(
    -- 집계(제출·평균·최고·정답률)는 현재 담당자만 — 배정 해제된 사람의 응시는 빼서 submitted ≤ assigned. 점수(평균·최고)는 정답 본 뒤 응시도 그대로
    'submitted', (select count(*)::int from public.exam_attempts a where a.node_id = n.id and a.status = 'SUBMITTED'
                  and public.is_task_assignee(n.id, a.user_id)),
    'assigned', (select count(*)::int from public.task_assignments a where a.node_id = n.id and a.released_at is null),
    'maxScore', x.total_points,
    'avg', (select round(avg(a.score)::numeric, 1) from public.exam_attempts a where a.node_id = n.id and a.status = 'SUBMITTED'
            and public.is_task_assignee(n.id, a.user_id)),
    'max', (select max(a.score) from public.exam_attempts a where a.node_id = n.id and a.status = 'SUBMITTED'
            and public.is_task_assignee(n.id, a.user_id)),
    -- 정답률에서 뺀 「정답 본 뒤 응시」 수
    'answersSeenExcluded', (select count(*)::int from public.exam_attempts a where a.node_id = n.id and a.status = 'SUBMITTED'
                            and public.is_task_assignee(n.id, a.user_id)
                            and exists (select 1 from public.exam_answer_reveals v where v.node_id = n.id and v.user_id = a.user_id)),
    -- 정답률 = 제출된 응시 중 정답 비율(응시 0 → null, pct 규칙). 정답 본 뒤 응시는 뺀다
    'questions', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id::text, 'ord', q.ord, 'type', lower(q.qtype), 'points', q.points,
                    'correctRate', (select public.pct(count(*)::int, (count(*) filter (where e.is_correct))::int)
                                    from public.exam_answers e join public.exam_attempts a on a.id = e.attempt_id
                                    where e.question_id = q.id and a.status = 'SUBMITTED'
                                      and public.is_task_assignee(n.id, a.user_id)
                                      and not exists (select 1 from public.exam_answer_reveals v where v.node_id = n.id and v.user_id = a.user_id))) order by q.ord), '[]'::jsonb)
                  from public.exam_questions q where q.node_id = n.id),
    -- 유효 담당자 전원(미제출 포함). 순서 = curriculum_json people(그룹장, joined_at, id). answersSeen = 제출했고 그 전에 정답을 봤다
    'members', (select coalesce(jsonb_agg(public.person_json(a.user_id) || jsonb_build_object(
                    'status', public.task_code(n.start_date, n.end_date, s.first_submitted_at, s.is_late, public.kst_today()),
                    'score', t.score, 'submittedAt', public.iso(t.submitted_at), 'isLate', s.is_late,
                    'answersSeen', t.id is not null and exists (select 1 from public.exam_answer_reveals v where v.node_id = n.id and v.user_id = a.user_id))
                  order by (m.role = 'LEADER') desc, m.joined_at nulls last, m.id), '[]'::jsonb)
                from public.task_assignments a
                join public.room_members m on m.room_id = r.id and m.user_id = a.user_id
                left join public.submissions s on s.node_id = n.id and s.user_id = a.user_id
                left join public.exam_attempts t on t.node_id = n.id and t.user_id = a.user_id and t.status = 'SUBMITTED'
                where a.node_id = n.id and a.released_at is null));
end $$;

-- ───────── 7. comment_exam_locked (0041 원문, 판정식 exam_reveal_for — exam_view 의 v_reveal 과 같다) ─────────
create or replace function public.comment_exam_locked(n public.goal_nodes, p_uid uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  x public.exams;
  r public.rooms;
  a public.exam_attempts;
begin
  select * into x from public.exams where node_id = n.id;
  if not found then return false; end if;
  select * into r from public.rooms where id = n.room_id;
  if coalesce(public.can_edit_curriculum(r, p_uid), false) then return false; end if;
  if p_uid is null or not public.is_task_assignee(n.id, p_uid) then return false; end if;
  select * into a from public.exam_attempts where node_id = n.id and user_id = p_uid;
  return not public.exam_reveal_for(x, n, a, p_uid);
end $$;
