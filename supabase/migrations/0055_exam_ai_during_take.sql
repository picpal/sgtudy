-- 0055_exam_ai_during_take.sql — 2026-11-02 사용자 결정: 시험별 옵션 「응시 중 AI 질문 허용」. 배포 후 수정 금지.
-- 1) exams.ai_during_take(기본 false — 기존 시험은 모두 꺼짐 = 지금 동작). 편집자 RPC exam_ai_take_set(응시가 있어도 바뀐다, exam_reveal_unsubmitted_set 과 같은 관문).
-- 2) ai_explain_begin 에 p_take_node(기본 null) — 응시 화면(source exam_take)에서 물을 때 라우트가 그 시험 node 를 넘긴다.
--    · 그 시험이 이 방 · 발행 · 옵션 켬이 아니면 EXAM_IN_PROGRESS(클라이언트가 보낸 source·node 를 믿지 않는다 — 서버가 옵션을 다시 본다).
--    · 응시 중 잠금(F3: IN_PROGRESS · 발행 · 보관 아님 · 마지막 활동 3시간 안)에서 그 시험 한 건만 뺀다. 다른(옵션 꺼진) 시험을 동시에 응시 중이면 그대로 잠긴다.
--      p_take_node 없이 부르는 다른 탭(진행목표·제출물·시험 결과·오답노트)은 F3 그대로 — 응시 중엔 방 전체 거부.
--    · 방 공유 캐시를 읽지 않는다(적중 없음·hits 그대로). 캐시는 authenticated ai_explain_done 으로 멤버가 직접 쓸 수 있어(F2), 응시 중에 정답을 옮겨 받는 길이 된다.
--      쓰기도 안 한다 — 라우트가 NO_SHARE_SOURCES(exam_take) 로 body 를 넘기지 않는다.
--    시그니처가 바뀌어(인자 추가) drop → create + GRANT. 인자 2개 호출(이전 라우트)은 기본값으로 그대로 맞는다 — DB 를 먼저 반영하고 코드를 배포한다.
-- 3) exam_view 재정의(0054 원문 + exam.aiDuringTake). 결과 화면에는 AI 사용 여부를 표시하지 않는다(사용자 결정).

-- ───────── 1. 스키마 ─────────
alter table public.exams add column ai_during_take boolean not null default false;

-- ───────── 2. 편집자 옵션 ─────────
create or replace function public.exam_ai_take_set(p_slug text, p_node bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v record; v_uid uuid := public.current_user_id();
begin
  select * into v from public.exam_editable_leaf(p_slug, p_node);   -- 방 잠금·편집자·리프·보관 아님
  if p_on is null then perform public.fail('VALIDATION_FAILED', '켜기·끄기를 골라 주세요', '{"field":"aiDuringTake"}'::jsonb); end if;
  update public.exams set ai_during_take = p_on, updated_at = now() where node_id = (v.n).id;
  if not found then perform public.fail('EXAM_NOT_FOUND', '시험이 없는 과제예요', jsonb_build_object('nodeId', (v.n).id::text)); end if;
  return public.exam_view((v.n).id, v_uid, v_uid);
end $$;

grant execute on function public.exam_ai_take_set(text, bigint, boolean) to authenticated;

-- ───────── 3. exam_view (0054 원문 + exam.aiDuringTake) ─────────
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
                                 'aiDuringTake', x.ai_during_take,
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


-- ───────── 4. ai_explain_begin (0053 원문 + p_take_node: 허용 시험 응시 화면은 그 시험만 잠금 제외 · 캐시 읽지 않음) ─────────
drop function public.ai_explain_begin(text, text);
create function public.ai_explain_begin(p_slug text, p_term_key text, p_take_node bigint default null) returns jsonb
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
  -- 응시 화면에서 물을 때(0055): 그 시험이 이 방 · 발행 · 옵션 켬이어야 한다. 편집자가 응시 중에 끄면 바로 다시 잠긴다
  if p_take_node is not null and not exists (
       select 1 from public.exams x where x.node_id = p_take_node and x.room_id = r.id and x.status = 'PUBLISHED' and x.ai_during_take) then
    perform public.fail('EXAM_IN_PROGRESS', '시험을 제출한 뒤에 쓸 수 있어요');
  end if;
  if exists (
       select 1 from public.exam_attempts a
       join public.exams x on x.node_id = a.node_id
       join public.goal_nodes n on n.id = a.node_id
       where a.user_id = v_uid and a.status = 'IN_PROGRESS' and x.room_id = r.id and x.status = 'PUBLISHED'
         and n.archived_at is null
         -- 허용 시험 응시 화면에서 물으면 그 시험 한 건만 뺀다(0055). 다른 시험을 함께 응시 중이면 잠긴다
         and a.node_id is distinct from p_take_node
         -- 마감 전후 무관(after_submit 지각 응시 포함, F3). 마지막 활동(시작·답 저장) 3시간 안만 — 답 하나 저장하고 방치하면 마감까지 방 전체가 잠기던 것을 막는다. 다시 답을 저장하면 다시 잠긴다
         and greatest(a.started_at, (select max(s.saved_at) from public.exam_answers s where s.attempt_id = a.id)) > v_now - interval '3 hours') then
    perform public.fail('EXAM_IN_PROGRESS', '시험을 제출한 뒤에 쓸 수 있어요');
  end if;

  -- 응시 화면 질문은 방 공유 캐시를 읽지 않는다(0055 — 멤버가 ai_explain_done 으로 직접 쓴 본문이 응시 중에 가지 않게)
  if p_take_node is null then
    select * into c from public.ai_explain_cache ec
     where ec.room_id = r.id and ec.term_key = p_term_key and ec.created_at > v_now - interval '30 days';
    if found then
      update public.ai_explain_cache set hits = hits + 1, last_hit_at = v_now
       where room_id = r.id and term_key = p_term_key;
      return jsonb_build_object('hit', true, 'body', c.body);
    end if;
  end if;

  v_turn := public.ai_turn_check('term_explain', false);

  select coalesce(jsonb_agg(t.label order by rt.sort_order, t.slug), '[]'::jsonb) into v_tags
  from public.room_tags rt join public.tags t on t.slug = rt.tag_slug where rt.room_id = r.id;
  select jsonb_build_object('label', coalesce(n.label, ''), 'title', n.title, 'goal', left(n.description_md, 300)) into v_round
  from public.goal_nodes n where n.id = public.room_current_round_id(r.id, v_today);

  return jsonb_build_object('hit', false, 'id', (v_turn ->> 'id')::bigint, 'room', jsonb_build_object(
    'title', r.title, 'intro', r.intro, 'description', left(r.description_md, 600), 'tags', v_tags, 'round', v_round));
end $$;

grant execute on function public.ai_explain_begin(text, text, bigint) to authenticated;
