-- 0051_wrong_note_bookmark.sql — 2026-10-27 오답노트 「다시 볼 문제」(★). 배포 후 수정 금지.
-- 추가형: 표 1개(exam_bookmark, RPC 전용 — exam_practice 와 같은 방식) + 공개 RPC 1개 + 재정의 1개(wrong_note_rounds, 시그니처 동일).
-- 정오·외웠어요와 무관한 별도 표시. 본인 전용(user_id = require_user, 남의 표시는 어디에도 나가지 않는다).
-- 공개 전 정답 비노출(0046 D3·D4) 유지: 토글 관문 = wrong_note_target(0046) 그대로 — 노트에 있고 정답이 공개된 문항만 표시할 수 있고,
--   목록의 bookmarked 키는 공개된 시험의 items 안에만 생긴다(잠긴 시험은 items 키가 없으니 ★ 여부·개수도 나가지 않는다).
-- 방 이탈(CANCELED 등)·보관: 행은 남기고(exam_practice 와 같다) 목록·토글 관문이 가린다 — 다시 참가하면 되살아난다. 문항 삭제 = cascade.

-- ───────── 1. 스키마 ─────────
create table public.exam_bookmark (
  user_id     uuid   not null references public.profiles(id) on delete cascade,
  question_id bigint not null references public.exam_questions(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.exam_bookmark enable row level security;
revoke all on public.exam_bookmark from anon, authenticated;            -- 정책 없음 = RPC 전용

-- ───────── 2. 목록 문항에 bookmarked (0046 원문 + bm 조인 · 'bookmarked' 키 한 줄) ─────────
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
               'no', q.ord + 1, 'mine', e.answer, 'practice', public.wrong_note_practice_json(p), 'mastered', p.mastered_at is not null,
               'bookmarked', bm.question_id is not null)
               order by q.ord), '[]'::jsonb)
             from public.exam_answers e
             join public.exam_questions q on q.id = e.question_id
             left join public.exam_practice p on p.user_id = p_uid and p.question_id = q.id
             left join public.exam_bookmark bm on bm.user_id = p_uid and bm.question_id = q.id
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

-- ───────── 3. 다시 볼 문제 켜기·끄기 ─────────
-- 관문은 외웠어요(wrong_note_master)와 같다 — 방(ROOM_NOT_FOUND) → 문항(NODE_NOT_FOUND) → 노트(NOT_IN) → 공개(LOCKED) → 오답(NOT_IN).
-- 켜기는 멱등(on conflict do nothing — created_at 은 처음 표시한 때), 끄기는 행 삭제
create or replace function public.wrong_note_bookmark(p_slug text, p_question bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  r     public.rooms;
  t     record;
begin
  r := public.wrong_note_room(p_slug, v_uid);
  if p_on is null then perform public.fail('VALIDATION_FAILED', '켜기·끄기를 정해 주세요', '{"field":"on"}'::jsonb); end if;
  select * into t from public.wrong_note_target(r.id, v_uid, p_question);
  if p_on then
    insert into public.exam_bookmark (user_id, question_id, created_at) values (v_uid, (t.q).id, public.app_now())
    on conflict (user_id, question_id) do nothing;
  else
    delete from public.exam_bookmark where user_id = v_uid and question_id = (t.q).id;
  end if;
  return jsonb_build_object('bookmarked', p_on);
end $$;

grant execute on function public.wrong_note_bookmark(text, bigint, boolean) to authenticated;
