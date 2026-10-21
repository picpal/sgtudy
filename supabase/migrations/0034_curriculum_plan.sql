-- 0034_curriculum_plan.sql — 2026-10-19 AI 연동(MCP) 1단계: 진행목표 계획서. 배포 후 수정 금지.
-- 스펙 §5·§7·§8. 재정의: node_create ← 0024(본문을 node_create_core 로 옮김, 시그니처·GRANT 동일),
--                      notification_kinds ← 0032, notify_render ← 0032 (둘 다 MEMBER_JOINED 유지), notify_link ← 0028 (Task 5).

-- ───────── 1. node_create_core (0024 node_create 본문 그대로 + 설명 인자, 잠금·권한·resync·json 은 호출자) ─────────
-- 내부 헬퍼 — GRANT 없음(0002 기본 권한이 막는다). r 은 호출자가 node_assert_editable 로 잠근 방.
create or replace function public.node_create_core(
  r public.rooms, p_uid uuid, p_parent_id bigint, p_title text, p_label text, p_task_type text,
  p_start_date date, p_end_date date, p_index int, p_description_md text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  p        public.goal_nodes;
  v_id     bigint;
  v_depth  int;
  v_round  bigint;
  v_title  text := nullif(trim(coalesce(p_title, '')), '');
  v_label  text := nullif(trim(coalesce(p_label, '')), '');
  -- 회차: taskType 이 없으면 빈 부모, 있으면 회차 자체가 과제인 depth-2 리프(A7). 하위: 기본 common
  v_type   text := upper(coalesce(p_task_type, case when p_parent_id is null then null else 'common' end));
  v_desc   text := coalesce(p_description_md, '');
  v_s      date;
  v_e      date;
  v_n      int;
  v_idx    int;
begin
  if v_type is not null and v_type not in ('COMMON', 'DESIGNATED') then
    perform public.fail('VALIDATION_FAILED', '과제 유형은 common 또는 designated 예요', '{"field":"taskType"}'::jsonb);
  end if;

  if p_parent_id is null then
    select count(*)::int, max(end_date) + 1 into v_n, v_s from public.goal_nodes where room_id = r.id and parent_id is null;
    v_depth := 2;
    v_title := coalesce(v_title, '새 회차');
    v_label := coalesce(v_label, (v_n + 1) || '주차');
    v_s     := coalesce(p_start_date, v_s, r.start_date);
    v_e     := coalesce(p_end_date, v_s + 6);
  else
    p := public.node_get(r.id, p_parent_id);
    if p.archived_at is not null then
      perform public.fail('PARENT_ARCHIVED', '보관된 항목 아래에는 추가할 수 없어요', jsonb_build_object('nodeId', p.id::text));
    end if;
    if p.depth >= 5 then
      perform public.fail('NODE_DEPTH_EXCEEDED', '최대 5단계까지만 만들 수 있어요', jsonb_build_object('nodeId', p.id::text));
    end if;
    if v_label is not null then
      perform public.fail('VALIDATION_FAILED', '회차 라벨은 회차에만 줄 수 있어요', '{"field":"label"}'::jsonb);
    end if;
    select count(*)::int into v_n from public.goal_nodes where parent_id = p.id;
    v_depth := p.depth + 1;
    v_round := p.round_id;
    v_title := coalesce(v_title, '새 과제');
    v_s := coalesce(p_start_date, p.start_date);
    v_e := coalesce(p_end_date, p.end_date);
  end if;

  if length(v_title) > 80 then perform public.fail('INVALID_TITLE', '제목은 1~80자예요', '{"field":"title"}'::jsonb); end if;
  if v_label is not null and length(v_label) > 20 then perform public.fail('VALIDATION_FAILED', '회차 라벨은 20자까지예요', '{"field":"label"}'::jsonb); end if;
  if v_s > v_e then perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb); end if;
  -- 0034 추가: 설명 길이
  if length(v_desc) > 20000 then perform public.fail('VALIDATION_FAILED', '설명은 20,000자까지예요', '{"field":"descriptionMd"}'::jsonb); end if;

  -- 제출물 없는 리프 아래에 자식을 만들면 그 리프는 부모로 전환 (I1)
  if p.id is not null and p.task_type is not null then
    perform public.node_make_parent(p, '제출물이 있는 과제 아래에는 추가할 수 없어요. 보관해 주세요');
  end if;

  v_idx := least(greatest(coalesce(p_index, v_n), 0), v_n);
  update public.goal_nodes set sort_order = sort_order + 1
  where room_id = r.id and parent_id is not distinct from p_parent_id and sort_order >= v_idx;

  insert into public.goal_nodes (room_id, parent_id, round_id, depth, sort_order, label, title, description_md, start_date, end_date, task_type, created_by)
  values (r.id, p_parent_id, v_round, v_depth, v_idx, v_label, v_title, v_desc, v_s, v_e, v_type, p_uid)   -- 0024: 작성자(#13)
  returning id into v_id;
  if p_parent_id is null then update public.goal_nodes set round_id = v_id where id = v_id; end if;
  return v_id;
end $$;

-- 0024 판과 시그니처·기본값 동일(GRANT 유지)
create or replace function public.node_create(
  p_slug text, p_parent_id bigint default null, p_title text default null, p_label text default null,
  p_task_type text default null, p_start_date date default null, p_end_date date default null, p_index int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r     public.rooms;
  v_uid uuid;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  perform public.node_create_core(r, v_uid, p_parent_id, p_title, p_label, p_task_type, p_start_date, p_end_date, p_index, '');
  perform public.assignment_resync(r.id);
  return public.curriculum_json(r.id, v_uid, true);
end $$;

-- ───────── 2. curriculum_version ─────────
-- 〔C#3〕 jsonb 배열 직렬화(문자열 이스케이프·null 자리 유지)의 md5. 세 부분: 방 설정 · ACTIVE 멤버([user_id, assign_from] — 재합류로 배정 시작일이 바뀌면 달라진다) · 팀 노드(id 순).
-- 제출·개인 목표(owner_id not null)는 반영하지 않는다. 내부 헬퍼 — GRANT 없음. p_room null → md5('[null, [], []]').
create or replace function public.curriculum_version(p_room bigint) returns text
language sql stable security definer set search_path = '' as $$
  select md5(jsonb_build_array(
    (select jsonb_build_array(r.start_date, r.end_date, r.status, r.leader_does_tasks, r.archived_at is not null)
       from public.rooms r where r.id = p_room),
    (select coalesce(jsonb_agg(jsonb_build_array(m.user_id, m.assign_from) order by m.user_id), '[]'::jsonb)
       from public.room_members m where m.room_id = p_room and m.status = 'ACTIVE'),
    (select coalesce(jsonb_agg(jsonb_build_array(n.id, n.parent_id, n.sort_order, n.depth, n.start_date, n.end_date, n.label, n.title,
              md5(n.description_md), n.task_type, n.archived_at,
              (select coalesce(jsonb_agg(a.user_id order by a.user_id), '[]'::jsonb) from public.task_assignments a
                where a.node_id = n.id and a.released_at is null and a.source = 'DESIGNATED'))
            order by n.id), '[]'::jsonb)
       from public.goal_nodes n where n.room_id = p_room and n.owner_id is null)
  )::text)
$$;

-- ───────── 3. 계획서 펼치기·이름 해석·shift·정적 검증 ─────────
-- 전부 내부 헬퍼 — GRANT 없음(0002 기본 권한). 예외를 던지지 않고 오류 목록을 돌려준다.
-- 순서(Task 4 preview): plan_shape_check(원본) → plan_resolve(원본 → 정규) → plan_validate(정규) → plan_run.

create or replace function public.plan_err(p_path text, p_code text, p_message text, p_field text default null) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('path', p_path, 'code', p_code, 'message', p_message, 'field', p_field))
$$;

-- 'YYYY-MM-DD' 이고 달력에 있는 날이면 date, 아니면 null (예외 없음)
create or replace function public.plan_date_try(p text) returns date
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $$;

-- 전위 순회. 최상위 ops[i], 하위 ops[i].children[j]… · op 에서 children(배열일 때) 제거 · 6단에서 멈춤
create or replace function public.plan_flatten(p_plan jsonb)
returns table (seq int, path text, parent_path text, has_children boolean, op jsonb)
language sql immutable set search_path = '' as $$
  with recursive f(path, parent_path, op, k) as (
    select 'ops[' || (o.i - 1) || ']', null::text, o.v, array[o.i]
    from jsonb_array_elements(case when jsonb_typeof(p_plan -> 'ops') = 'array' then p_plan -> 'ops' else '[]'::jsonb end)
         with ordinality o(v, i)
    union all
    select f.path || '.children[' || (c.i - 1) || ']', f.path, c.v, f.k || c.i
    from f cross join lateral jsonb_array_elements(
           case when jsonb_typeof(f.op) = 'object' and jsonb_typeof(f.op -> 'children') = 'array' then f.op -> 'children' else '[]'::jsonb end)
         with ordinality c(v, i)
    where cardinality(f.k) < 6                                  -- 〔C#11〕 6단에서 멈춤(더 깊은 계획서는 plan_shape_check 가 먼저 거부)
  )
  select (row_number() over (order by k))::int, path, parent_path,
         coalesce(jsonb_typeof(op) = 'object' and jsonb_typeof(op -> 'children') = 'array' and jsonb_array_length(op -> 'children') > 0, false),
         -- 배열 children 만 뗀다. 배열이 아닌 children 은 남겨 plan_validate 가 PLAN_INVALID 로 보고한다
         case when jsonb_typeof(op) = 'object' and jsonb_typeof(op -> 'children') = 'array' then op - 'children' else op end
  from f order by k
$$;

-- 오류 문구·field 에 되돌려 싣는 사용자 문자열 상한(40자 + …)
create or replace function public.plan_clip(p text) returns text
language sql immutable set search_path = '' as $$
  select case when length(p) > 40 then left(p, 40) || '…' else p end
$$;

-- 〔C#11〕 해석(plan_resolve — 재귀·멤버 조회) 전에 값싼 모양·크기 거부. 통과면 null. 예외 없음
create or replace function public.plan_shape_check(p_plan jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_deep boolean; v_key text;
begin
  if jsonb_typeof(p_plan) is distinct from 'object' or p_plan ->> 'schema' is distinct from 'sgtudy.plan/v1' then
    return public.plan_err('$', 'PLAN_INVALID', '계획서 schema 는 sgtudy.plan/v1 이어야 해요', 'schema');
  end if;
  if jsonb_typeof(p_plan -> 'ops') is distinct from 'array' or jsonb_array_length(p_plan -> 'ops') = 0 then
    return public.plan_err('$', 'PLAN_INVALID', 'ops 에 할 일을 1개 이상 넣어 주세요', 'ops');
  end if;
  if octet_length(p_plan::text) > 262144 then
    return public.plan_err('$', 'PLAN_TOO_LARGE', '계획서는 256KB 까지예요');
  end if;
  select key into v_key from jsonb_object_keys(p_plan) key where key not in ('schema', 'ops', 'baseVersion') order by key limit 1;
  if v_key is not null then
    return public.plan_err('$', 'PLAN_INVALID', '계획서에 쓸 수 없는 항목이에요(schema·ops·baseVersion 만)', public.plan_clip(v_key));
  end if;
  if jsonb_array_length(p_plan -> 'ops') > 200 then
    return public.plan_err('$', 'PLAN_TOO_LARGE', '한 번에 200개 항목까지예요');
  end if;
  with recursive w(v, d) as (
    select o, 1 from jsonb_array_elements(p_plan -> 'ops') o
    union all
    select c, w.d + 1 from w cross join lateral jsonb_array_elements(
      case when jsonb_typeof(w.v) = 'object' and jsonb_typeof(w.v -> 'children') = 'array' then w.v -> 'children' else '[]'::jsonb end) c
    where w.d < 7)
  select exists (select 1 from w where d = 7) into v_deep;
  if v_deep then return public.plan_err('$', 'PLAN_INVALID', '하위 항목은 6단계까지만 중첩할 수 있어요', 'children'); end if;
  return null;
end $$;

-- 〔UX 재검토 D14〕 회차 선택자 → {id} | {error:{code, message, candidates}}. 예외 없음.
-- JSON 수 = 서수(1부터) · "current" = 오늘(KST) 회차, 없으면 첫 회차 · 숫자 문자열 = 이 방 회차 id · 그 밖 = 라벨(trim) 정확 일치.
-- 대상 = 이 방 보관 안 된 회차(sort_order, id 순). 라벨이 겹치면 추측하지 않는다(ROUND_AMBIGUOUS).
create or replace function public.plan_round_pick(r public.rooms, p_sel jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rounds jsonb;    -- [{id, label, title, ord}]
  v_txt    text;
  v_id     text;
  v_hits   jsonb;
  v_num    numeric;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id::text, 'label', x.label, 'title', x.title, 'ord', x.ord) order by x.ord), '[]'::jsonb)
    into v_rounds
  from (select n.id, n.label, n.title, row_number() over (order by n.sort_order, n.id) as ord
        from public.goal_nodes n
        where n.room_id = r.id and n.parent_id is null and n.archived_at is null) x;

  if jsonb_typeof(p_sel) = 'number' then
    v_num := p_sel::text::numeric;
    if v_num = trunc(v_num) and v_num >= 1 then
      select e ->> 'id' into v_id from jsonb_array_elements(v_rounds) e where (e ->> 'ord')::numeric = v_num;
    end if;
  elsif jsonb_typeof(p_sel) = 'string' then
    v_txt := trim(p_sel #>> '{}');
    if lower(v_txt) = 'current' then
      v_id := public.room_current_round_id(r.id, public.kst_today())::text;
      if v_id is null or not exists (select 1 from jsonb_array_elements(v_rounds) e where e ->> 'id' = v_id) then
        v_id := v_rounds -> 0 ->> 'id';
      end if;
    else
      if v_txt ~ '^\d{1,18}$' then
        select e ->> 'id' into v_id from jsonb_array_elements(v_rounds) e where e ->> 'id' = (v_txt::bigint)::text;
      end if;
      if v_id is null and v_txt <> '' then
        select coalesce(jsonb_agg(e order by (e ->> 'ord')::int), '[]'::jsonb) into v_hits
        from jsonb_array_elements(v_rounds) e where trim(coalesce(e ->> 'label', '')) = v_txt;
        if jsonb_array_length(v_hits) = 1 then
          v_id := v_hits -> 0 ->> 'id';
        elsif jsonb_array_length(v_hits) > 1 then
          return jsonb_build_object('error', jsonb_build_object(
            'code', 'ROUND_AMBIGUOUS', 'message', '같은 라벨의 회차가 여러 개예요. 몇 번째 회차인지(숫자)나 id 로 골라 주세요',
            'candidates', (select jsonb_agg((h ->> 'ord') || '번째 · ' || coalesce(h ->> 'label', '') || ' · ' || (h ->> 'title') order by (h ->> 'ord')::int)
                           from (select h from jsonb_array_elements(v_hits) h limit 20) s)));
        end if;
      end if;
    end if;
  end if;

  if v_id is not null then return jsonb_build_object('id', v_id); end if;
  return jsonb_build_object('error', jsonb_build_object(
    'code', 'ROUND_NOT_FOUND', 'message', '회차를 찾을 수 없어요',
    'candidates', (select coalesce(jsonb_agg(coalesce(e ->> 'label', e ->> 'title') order by (e ->> 'ord')::int), '[]'::jsonb)
                   from (select e from jsonb_array_elements(v_rounds) e limit 20) s)));
end $$;

-- 두 jsonb 배열을 순서 유지·중복 제거로 합친다
create or replace function public.plan_jsonb_union(a jsonb, b jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(v order by n), '[]'::jsonb)
  from (select distinct on (v) v, n from jsonb_array_elements(a || b) with ordinality t(v, n) order by v, n) s
$$;

-- 〔D14〕 담당 목록(닉네임|userId) → {ids:[uuid…]} | {error:{code, message, candidates?}}. p_members = {닉네임: [uuid…]}(ACTIVE)
-- uuid 형식이면 그대로(소문자) — 존재·자격 검증은 node_update 가 한다. 후보에는 uuid 를 싣지 않는다(같은 닉네임 수만큼 닉네임).
create or replace function public.plan_assignees(p_val jsonb, p_members jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  e     jsonb;
  v_t   text;
  v_ids jsonb := '[]'::jsonb;
  v_hit jsonb;
begin
  if jsonb_typeof(p_val) is distinct from 'array' then
    return jsonb_build_object('error', jsonb_build_object('code', 'PLAN_INVALID', 'message', '담당자는 닉네임 목록이어야 해요'));
  end if;
  for e in select x from jsonb_array_elements(p_val) x loop
    if jsonb_typeof(e) <> 'string' then
      return jsonb_build_object('error', jsonb_build_object('code', 'PLAN_INVALID', 'message', '담당자는 닉네임 목록이어야 해요'));
    end if;
    v_t := trim(e #>> '{}');
    if v_t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_t := lower(v_t);
    else
      v_hit := coalesce(p_members -> v_t, '[]'::jsonb);
      if jsonb_array_length(v_hit) = 0 then
        return jsonb_build_object('error', jsonb_build_object('code', 'ASSIGNEE_NOT_MEMBER',
          'message', '「' || public.plan_clip(v_t) || '」 님은 이 스터디의 활성 참가자가 아니에요'));
      elsif jsonb_array_length(v_hit) > 1 then
        return jsonb_build_object('error', jsonb_build_object('code', 'ASSIGNEE_AMBIGUOUS',
          'message', '「' || public.plan_clip(v_t) || '」 닉네임의 참가자가 여러 명이에요. userId 로 지정해 주세요',
          'candidates', (select jsonb_agg(to_jsonb(public.plan_clip(v_t))) from jsonb_array_elements(v_hit))));
      end if;
      v_t := v_hit ->> 0;
    end if;
    if not v_ids ? v_t then v_ids := v_ids || to_jsonb(v_t); end if;
  end loop;
  return jsonb_build_object('ids', v_ids);
end $$;

-- create 노드(하위 포함) 하나의 assignees → assigneeIds. {node, errors}. 〔C#11〕 depth > 6 이면 더 내려가지 않는다
create or replace function public.plan_resolve_node(r public.rooms, p_node jsonb, p_path text, p_members jsonb, p_depth int) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_node jsonb := p_node;
  v_errs jsonb := '[]'::jsonb;
  v_a    jsonb;
  v_kids jsonb := '[]'::jsonb;
  c      record;
  v_sub  jsonb;
begin
  if jsonb_typeof(p_node) is distinct from 'object' then
    return jsonb_build_object('node', p_node, 'errors', v_errs);
  end if;
  if p_node ? 'assignees' then
    v_a := public.plan_assignees(p_node -> 'assignees', p_members);
    if v_a ? 'error' then
      v_errs := v_errs || (jsonb_build_object('path', p_path, 'field', 'assignees') || (v_a -> 'error'));
    else
      v_node := (v_node - 'assignees') || jsonb_build_object('assigneeIds',
        case when jsonb_typeof(p_node -> 'assigneeIds') = 'array'
             then public.plan_jsonb_union(p_node -> 'assigneeIds', v_a -> 'ids')
             else v_a -> 'ids' end);
    end if;
  end if;
  if jsonb_typeof(p_node -> 'children') = 'array' and p_depth < 6 then
    for c in select x, i from jsonb_array_elements(p_node -> 'children') with ordinality t(x, i) loop
      v_sub := public.plan_resolve_node(r, c.x, p_path || '.children[' || (c.i - 1) || ']', p_members, p_depth + 1);
      v_kids := v_kids || jsonb_build_array(v_sub -> 'node');
      v_errs := v_errs || (v_sub -> 'errors');
    end loop;
    v_node := v_node || jsonb_build_object('children', v_kids);
  end if;
  return jsonb_build_object('node', v_node, 'errors', v_errs);
end $$;

-- 〔UX 재검토 D14·D15〕 원본 계획서 → 정규 계획서 {plan, errors, map}. 예외 없음.
-- ① parent:{round:sel} → id 문자열(create·move) ② assignees → assigneeIds(create 하위 포함, update set) ③ shift → 회차별 update.
-- map = 정규 경로(ops[k]) → 원래 경로(같으면 생략, shift 가 펼친 op 는 ops[i]#n). schema·ops 형태 오류는 그대로 넘긴다(plan_validate 가 보고).
create or replace function public.plan_resolve(r public.rooms, p_plan jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_members jsonb;
  v_rounds  jsonb;            -- [{id, s, e, kids}] 보관 제외 회차(sort_order, id 순)
  v_ops     jsonb := '[]'::jsonb;
  v_map     jsonb := '{}'::jsonb;
  v_errs    jsonb := '[]'::jsonb;   -- [{o: 원래 op 순번, e: 오류}]
  v_touch   jsonb := '{}'::jsonb;   -- shift 가 건드린 회차 id → 원래 경로
  v_um      jsonb := '[]'::jsonb;   -- update/move 의 [id, 원래 경로, 순번]
  o         record;
  v_op      jsonb;
  v_path    text;
  v_kind    text;
  v_pick    jsonb;
  v_res     jsonb;
  v_a       jsonb;
  v_days    numeric;
  v_from    int;
  v_to      int;
  v_err     jsonb;
  v_n       int;
  k         text;
  x         jsonb;
begin
  if jsonb_typeof(p_plan) is distinct from 'object' or jsonb_typeof(p_plan -> 'ops') is distinct from 'array' then
    return jsonb_build_object('plan', p_plan, 'errors', '[]'::jsonb, 'map', '{}'::jsonb);
  end if;

  select coalesce(jsonb_object_agg(t.nickname, t.ids), '{}'::jsonb) into v_members
  from (select p.nickname, jsonb_agg(m.user_id::text order by m.user_id) as ids
        from public.room_members m join public.profiles p on p.id = m.user_id
        where m.room_id = r.id and m.status = 'ACTIVE' and p.nickname is not null
        group by p.nickname) t;

  select coalesce(jsonb_agg(jsonb_build_object('id', n.id::text, 's', n.start_date, 'e', n.end_date,
           'kids', n.task_type is null and exists (select 1 from public.goal_nodes c where c.parent_id = n.id))
         order by n.sort_order, n.id), '[]'::jsonb)
    into v_rounds
  from public.goal_nodes n where n.room_id = r.id and n.parent_id is null and n.archived_at is null;

  for o in select v, i::int from jsonb_array_elements(p_plan -> 'ops') with ordinality t(v, i) loop
    v_path := 'ops[' || (o.i - 1) || ']';
    v_op := o.v;
    v_kind := case when jsonb_typeof(v_op) = 'object' then v_op ->> 'op' end;
    v_err := null;

    if v_kind = 'shift' then
      -- 키 · days · from · to · 순서
      select key into k from jsonb_object_keys(v_op) key where key not in ('op', 'from', 'to', 'days') limit 1;
      if k is not null then
        v_err := public.plan_err(v_path, 'PLAN_INVALID', 'shift 에 쓸 수 없는 항목이에요', public.plan_clip(k));
      elsif jsonb_typeof(v_op -> 'days') is distinct from 'number'
            or (v_op ->> 'days')::numeric <> trunc((v_op ->> 'days')::numeric)
            or abs((v_op ->> 'days')::numeric) > 180 or (v_op ->> 'days')::numeric = 0 then
        v_err := public.plan_err(v_path, 'PLAN_INVALID', 'days 는 -180~180 사이 0 이 아닌 정수예요', 'days');
      elsif v_op -> 'from' is null or v_op -> 'from' = 'null'::jsonb then
        v_err := public.plan_err(v_path, 'PLAN_INVALID', 'shift 에는 from(시작 회차)이 필요해요', 'from');
      else
        v_days := (v_op ->> 'days')::numeric;
        v_pick := public.plan_round_pick(r, v_op -> 'from');
        if v_pick ? 'error' then
          v_err := jsonb_build_object('path', v_path, 'field', 'from') || (v_pick -> 'error');
        else
          select (e.i - 1)::int into v_from from jsonb_array_elements(v_rounds) with ordinality e(x, i) where e.x ->> 'id' = v_pick ->> 'id';
          if v_op -> 'to' is null or v_op -> 'to' = 'null'::jsonb then
            v_to := jsonb_array_length(v_rounds) - 1;
          else
            v_pick := public.plan_round_pick(r, v_op -> 'to');
            if v_pick ? 'error' then
              v_err := jsonb_build_object('path', v_path, 'field', 'to') || (v_pick -> 'error');
            else
              select (e.i - 1)::int into v_to from jsonb_array_elements(v_rounds) with ordinality e(x, i) where e.x ->> 'id' = v_pick ->> 'id';
            end if;
          end if;
          if v_err is null and v_from > v_to then
            v_err := public.plan_err(v_path, 'PLAN_INVALID', 'from 회차가 to 회차보다 뒤에 있어요', 'to');
          end if;
        end if;
      end if;
      if v_err is null then
        -- 다른 shift 와 겹치면 충돌
        select public.plan_err(v_path, 'PLAN_INVALID', '같은 회차를 다른 op(' || (v_touch ->> (e.x ->> 'id')) || ')도 바꿔요', 'SHIFT_CONFLICT')
          into v_err
        from jsonb_array_elements(v_rounds) with ordinality e(x, i)
        where (e.i - 1) between v_from and v_to and v_touch ? (e.x ->> 'id') limit 1;
      end if;
      if v_err is not null then
        v_errs := v_errs || jsonb_build_object('o', o.i, 'e', v_err);
        -- 오류여도 원래 op 를 그대로 둬 뒤 op 의 순번이 어긋나지 않게 한다(오류가 있으면 preview 는 validate 전에 멈춘다)
        if jsonb_array_length(v_ops) <> o.i - 1 then
          v_map := v_map || jsonb_build_object('ops[' || jsonb_array_length(v_ops) || ']', v_path);
        end if;
        v_ops := v_ops || jsonb_build_array(v_op);
        continue;
      end if;
      v_n := 0;
      for x in select e.x from jsonb_array_elements(v_rounds) with ordinality e(x, i) where (e.i - 1) between v_from and v_to order by e.i loop
        v_map := v_map || jsonb_build_object('ops[' || jsonb_array_length(v_ops) || ']', v_path || '#' || v_n);
        v_ops := v_ops || jsonb_build_array(jsonb_build_object('op', 'update', 'id', x ->> 'id', 'set',
          jsonb_build_object('startDate', to_char((x ->> 's')::date + v_days::int, 'YYYY-MM-DD'),
                             'endDate',   to_char((x ->> 'e')::date + v_days::int, 'YYYY-MM-DD'))
          || case when (x ->> 'kids')::boolean then '{"shiftDescendants": true}'::jsonb else '{}'::jsonb end));
        v_touch := v_touch || jsonb_build_object(x ->> 'id', v_path);
        v_n := v_n + 1;
      end loop;
      continue;
    end if;

    if jsonb_typeof(v_op) = 'object' then
      -- ① parent:{round:sel}
      if v_kind in ('create', 'move') and jsonb_typeof(v_op -> 'parent') = 'object' then
        if (select count(*) from jsonb_object_keys(v_op -> 'parent')) <> 1 or not (v_op -> 'parent') ? 'round' then
          v_err := public.plan_err(v_path, 'PLAN_INVALID', 'parent 는 id·"@ref"·{"round": 회차} 중 하나예요', 'parent');
        else
          v_pick := public.plan_round_pick(r, v_op -> 'parent' -> 'round');
          if v_pick ? 'error' then
            v_err := jsonb_build_object('path', v_path, 'field', 'parent') || (v_pick -> 'error');
          else
            v_op := v_op || jsonb_build_object('parent', v_pick ->> 'id');
          end if;
        end if;
      end if;
      -- ② assignees
      if v_err is null and v_kind = 'create' then
        v_res := public.plan_resolve_node(r, v_op, v_path, v_members, 1);
        v_op := v_res -> 'node';
        v_err := v_res -> 'errors';     -- 배열(하위 경로 포함)
        if jsonb_array_length(v_err) = 0 then v_err := null; end if;
      elsif v_err is null and v_kind = 'update' and jsonb_typeof(v_op -> 'set') = 'object' and (v_op -> 'set') ? 'assignees' then
        v_a := public.plan_assignees(v_op -> 'set' -> 'assignees', v_members);
        if v_a ? 'error' then
          v_err := jsonb_build_object('path', v_path, 'field', 'assignees') || (v_a -> 'error');
        else
          v_op := jsonb_set(v_op, '{set}', ((v_op -> 'set') - 'assignees') || jsonb_build_object('assigneeIds',
            case when jsonb_typeof(v_op -> 'set' -> 'assigneeIds') = 'array'
                 then public.plan_jsonb_union(v_op -> 'set' -> 'assigneeIds', v_a -> 'ids')
                 else v_a -> 'ids' end));
        end if;
      end if;
      if v_err is not null then
        if jsonb_typeof(v_err) = 'array' then
          select v_errs || coalesce(jsonb_agg(jsonb_build_object('o', o.i, 'e', y)), '[]'::jsonb) into v_errs from jsonb_array_elements(v_err) y;
        else
          v_errs := v_errs || jsonb_build_object('o', o.i, 'e', v_err);
        end if;
      end if;
      -- 숫자 id 는 정규형으로("00123" → "123") — shift 충돌 검사·실행이 같은 노드로 본다
      if v_kind in ('update', 'move') and jsonb_typeof(v_op -> 'id') = 'string' and (v_op ->> 'id') ~ '^\d{1,18}$' then
        v_op := v_op || jsonb_build_object('id', ((v_op ->> 'id')::bigint)::text);
        v_um := v_um || jsonb_build_array(jsonb_build_array(v_op ->> 'id', v_path, o.i, v_kind,
          v_kind = 'update' and jsonb_typeof(v_op -> 'set') = 'object'
          and ((v_op -> 'set') ?| array['startDate', 'endDate', 'shiftDescendants'])));
      end if;
    end if;

    if jsonb_array_length(v_ops) <> o.i - 1 then
      v_map := v_map || jsonb_build_object('ops[' || jsonb_array_length(v_ops) || ']', v_path);
    end if;
    v_ops := v_ops || jsonb_build_array(v_op);
  end loop;

  -- ③ shift 가 펼친 회차를 다른 update/move 가 건드리면 충돌(앞뒤 순서 무관)
  -- 하위 항목: shift 가 함께 옮기는(shiftDescendants) 회차 안 노드의 날짜를 바꾸는 update 도 충돌.
  -- 하위의 move·날짜 외 update 는 허용(스펙 §5.2 N2: shift → 자식 move 는 기록된 날짜로 되돌린다)
  for x in select u from jsonb_array_elements(v_um) u loop
    if v_touch ? (x ->> 0) then
      v_errs := v_errs || jsonb_build_object('o', (x ->> 2)::int, 'e',
        public.plan_err(x ->> 1, 'PLAN_INVALID', 'shift(' || (v_touch ->> (x ->> 0)) || ')가 옮기는 회차를 이 op 도 바꿔요', 'SHIFT_CONFLICT'));
    elsif (x ->> 4)::boolean then
      select n.round_id::text into k from public.goal_nodes n where n.id = (x ->> 0)::bigint and n.room_id = r.id;
      if k is not null and v_touch ? k then
        v_errs := v_errs || jsonb_build_object('o', (x ->> 2)::int, 'e',
          public.plan_err(x ->> 1, 'PLAN_INVALID', 'shift(' || (v_touch ->> k) || ')가 함께 옮기는 회차 안 항목의 날짜를 이 op 도 바꿔요', 'SHIFT_CONFLICT'));
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'plan', jsonb_set(p_plan, '{ops}', v_ops),
    'errors', (select coalesce(jsonb_agg(z.v -> 'e' order by (z.v ->> 'o')::int, z.n), '[]'::jsonb)
               from jsonb_array_elements(v_errs) with ordinality z(v, n)),
    'map', v_map);
end $$;

-- 정규 경로 → 원래 경로. 항목 path 의 앞부분 ops[k] 가 map 에 있으면 path 를 바꾸고 원래 값은 rpath 로 보존. 없으면 그대로
create or replace function public.plan_map_paths(p_items jsonb, p_map jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(
           case when jsonb_typeof(it) = 'object' and (it ->> 'path') ~ '^ops\[\d+\]'
                     and p_map ? substring(it ->> 'path' from '^ops\[\d+\]')
                then it || jsonb_build_object(
                       'path', (p_map ->> substring(it ->> 'path' from '^ops\[\d+\]')) || substring(it ->> 'path' from '^ops\[\d+\](.*)$'),
                       'rpath', it ->> 'path')
                else it end
           order by n), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) with ordinality t(it, n)
$$;

-- 정규 계획서(plan_resolve 결과)의 정적 오류를 **모두** 모은다(op 하나에 첫 오류 1건, seq 순). 예외 없음.
-- 반환 {errors:[{path, code, message, field?}], warnings:[{path, code, message}], nodes}. 스펙 §7.2 표.
-- 기본 날짜 시뮬레이션: 회차 생략 → (지금까지 회차 끝 최댓값 + 1 | 방 시작) ~ +6 (node_create_core 와 같다, 계획서 앞 회차 포함), 하위 생략 → 부모 기간.
create or replace function public.plan_validate(r public.rooms, p_plan jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  f         record;
  o         jsonb;
  s         jsonb;            -- update set
  v_kind    text;
  v_err     jsonb := '[]'::jsonb;
  v_warn    jsonb := '[]'::jsonb;
  v_refs    jsonb := '{}'::jsonb;   -- ref → path
  v_info    jsonb := '{}'::jsonb;   -- create path → {depth, s, e}
  v_pinfo   jsonb;
  v_node    public.goal_nodes;
  v_e1      jsonb;            -- 이 op 의 첫 오류
  v_depth   int;
  v_ps      date;
  v_pe      date;
  v_s       date;
  v_e       date;
  v_last    date;             -- 회차 끝 최댓값(기존 + 계획서 앞 회차)
  v_type    text;
  v_n       int;
  v_heavy   int;
  v_shape   jsonb;
  v_ref     text;
  v_pid     text;
  k         text;
begin
  v_shape := public.plan_shape_check(p_plan);   -- 〔C#11〕 단독 호출 대비(공개 경로는 preview 가 resolve 전에 이미 걸렀다)
  if v_shape is not null then
    return jsonb_build_object('errors', jsonb_build_array(v_shape), 'warnings', '[]'::jsonb, 'nodes', 0);
  end if;

  -- 크기: 노드 ≤ 200 · 무거운 op(update · move · assigneeIds 있는 create — 각각 curriculum_json 1회) ≤ 50
  select count(*)::int,
         count(*) filter (where jsonb_typeof(x.op) = 'object' and (
           (x.parent_path is null and x.op ->> 'op' in ('update', 'move'))
           or (coalesce(x.op ->> 'op', case when x.parent_path is not null then 'create' end) = 'create' and x.op ? 'assigneeIds')))::int
    into v_n, v_heavy
  from public.plan_flatten(p_plan) x;
  if v_n > 200 then
    return jsonb_build_object('errors', jsonb_build_array(public.plan_err('$', 'PLAN_TOO_LARGE', '한 번에 200개 항목까지예요')), 'warnings', '[]'::jsonb, 'nodes', v_n);
  end if;
  if v_heavy > 50 then
    return jsonb_build_object('errors', jsonb_build_array(public.plan_err('$', 'PLAN_TOO_LARGE',
      '기존 항목 수정·이동·담당 지정은 한 번에 50개까지예요. 나눠서 미리보기 해 주세요')), 'warnings', '[]'::jsonb, 'nodes', v_n);
  end if;

  select max(end_date) into v_last from public.goal_nodes where room_id = r.id and parent_id is null;

  for f in select * from public.plan_flatten(p_plan) loop
    o := f.op;
    v_e1 := null;
    if jsonb_typeof(o) is distinct from 'object' then
      v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', '항목은 객체여야 해요');
      continue;
    end if;

    -- (a) op 종류
    if f.parent_path is not null then
      if o ? 'op' and o -> 'op' is distinct from '"create"'::jsonb then
        v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', 'children 안에는 create 만 쓸 수 있어요', 'op');
        continue;
      end if;
      v_kind := 'create';
    else
      v_kind := case when jsonb_typeof(o -> 'op') = 'string' then o ->> 'op' end;
      if v_kind is null then
        v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', 'op 가 필요해요', 'op');
        continue;
      elsif v_kind in ('archive', 'delete', 'unarchive') then
        v_err := v_err || public.plan_err(f.path, 'DESTRUCTIVE_OP_NOT_ALLOWED', '보관·삭제는 AI 로 할 수 없어요. 웹에서 해 주세요');
        continue;
      elsif v_kind not in ('create', 'update', 'move') then
        v_err := v_err || public.plan_err(f.path, 'UNKNOWN_OP', '알 수 없는 op 예요: ' || public.plan_clip(v_kind), 'op');
        continue;
      end if;
    end if;
    if v_kind <> 'create' and f.has_children then
      v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', 'children 은 create 에만 쓸 수 있어요', 'children');
      continue;
    end if;

    if v_kind = 'create' then
      -- 키
      select key into k from jsonb_object_keys(o) key
      where key not in ('op', 'ref', 'parent', 'label', 'title', 'startDate', 'endDate', 'descriptionMd', 'taskType', 'assigneeIds', 'index')
      limit 1;
      if k is not null then v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', '쓸 수 없는 항목이에요', public.plan_clip(k)); continue; end if;
      if f.parent_path is not null and o ? 'parent' then
        v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', 'children 안의 항목은 parent 를 쓰지 않아요(바깥 항목이 부모)', 'parent');
        continue;
      end if;
      -- ref 형식·중복
      v_ref := null;
      if o ? 'ref' and o -> 'ref' <> 'null'::jsonb then
        if jsonb_typeof(o -> 'ref') <> 'string' or (o ->> 'ref') !~ '^[A-Za-z0-9_-]{1,32}$' then
          v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', 'ref 는 영문·숫자·_·- 1~32자예요', 'ref'); continue;
        end if;
        v_ref := o ->> 'ref';
        if v_refs ? v_ref then
          v_err := v_err || public.plan_err(f.path, 'DUPLICATE_REF', 'ref 「' || v_ref || '」 가 이미 ' || (v_refs ->> v_ref) || ' 에 있어요', 'ref'); continue;
        end if;
        v_refs := v_refs || jsonb_build_object(v_ref, f.path);
      end if;

      -- (b) 부모 결정
      v_pinfo := null;
      if f.parent_path is not null then
        v_pinfo := v_info -> f.parent_path;
        if v_pinfo is null then continue; end if;          -- 부모가 오류 → 조용히 건너뜀
      elsif o -> 'parent' is null or o -> 'parent' = 'null'::jsonb then
        v_pinfo := null;                                    -- 회차
      elsif jsonb_typeof(o -> 'parent') = 'string' and left(o ->> 'parent', 1) = '@' then
        if not v_refs ? substr(o ->> 'parent', 2) or v_refs ->> substr(o ->> 'parent', 2) = f.path then
          v_err := v_err || public.plan_err(f.path, 'UNKNOWN_REF', '앞선 create 에 ref 「' || public.plan_clip(substr(o ->> 'parent', 2)) || '」 가 없어요', 'parent'); continue;
        end if;
        v_pinfo := v_info -> (v_refs ->> substr(o ->> 'parent', 2));
        if v_pinfo is null then continue; end if;
      elsif jsonb_typeof(o -> 'parent') = 'string' and (o ->> 'parent') ~ '^\d{1,18}$' then
        select * into v_node from public.goal_nodes where id = (o ->> 'parent')::bigint and room_id = r.id;
        if not found then
          v_err := v_err || public.plan_err(f.path, 'NODE_NOT_FOUND', '항목을 찾을 수 없어요', 'parent'); continue;
        elsif v_node.task_type = 'PERSONAL' then
          v_err := v_err || public.plan_err(f.path, 'PERSONAL_NODE', '개인 목표는 진행목표 편집으로 바꿀 수 없어요', 'parent'); continue;
        elsif v_node.archived_at is not null then
          v_err := v_err || public.plan_err(f.path, 'PARENT_ARCHIVED', '보관된 항목 아래에는 추가할 수 없어요', 'parent'); continue;
        end if;
        v_pinfo := jsonb_build_object('depth', v_node.depth, 's', v_node.start_date, 'e', v_node.end_date);
      else
        v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', 'parent 는 null·id·"@ref"·{"round": 회차} 중 하나예요', 'parent'); continue;
      end if;

      if v_pinfo is null then
        v_depth := 2;
      else
        if (v_pinfo ->> 'depth')::int >= 5 then
          v_err := v_err || public.plan_err(f.path, 'NODE_DEPTH_EXCEEDED', '최대 5단계까지만 만들 수 있어요'); continue;
        end if;
        v_depth := (v_pinfo ->> 'depth')::int + 1;
        v_ps := (v_pinfo ->> 's')::date;
        v_pe := (v_pinfo ->> 'e')::date;
      end if;

      -- 제목 · 라벨 · 설명
      if jsonb_typeof(o -> 'title') is distinct from 'string' or length(trim(o ->> 'title')) not between 1 and 80 then
        v_err := v_err || public.plan_err(f.path, 'INVALID_TITLE', '제목은 1~80자예요', 'title'); continue;
      end if;
      if o ? 'label' and o -> 'label' <> 'null'::jsonb then
        if v_depth <> 2 then v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '회차 라벨은 회차에만 줄 수 있어요', 'label'); continue; end if;
        if jsonb_typeof(o -> 'label') <> 'string' or length(trim(o ->> 'label')) > 20 then
          v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '회차 라벨은 20자까지예요', 'label'); continue;
        end if;
      end if;
      if o ? 'descriptionMd' and o -> 'descriptionMd' <> 'null'::jsonb
         and (jsonb_typeof(o -> 'descriptionMd') <> 'string' or length(o ->> 'descriptionMd') > 20000) then
        v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '설명은 20,000자까지의 문자열이에요', 'descriptionMd'); continue;
      end if;

      -- 과제 유형 · 담당
      v_type := null;
      if o ? 'taskType' and o -> 'taskType' <> 'null'::jsonb then
        if jsonb_typeof(o -> 'taskType') <> 'string' or upper(o ->> 'taskType') not in ('COMMON', 'DESIGNATED') then
          v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '과제 유형은 common 또는 designated 예요', 'taskType'); continue;
        end if;
        if f.has_children then
          v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', '하위 항목(children)이 있으면 taskType 을 줄 수 없어요(묶음)', 'taskType'); continue;
        end if;
        v_type := upper(o ->> 'taskType');
      elsif v_depth > 2 and not f.has_children then
        v_type := 'COMMON';
      end if;
      if o ? 'assigneeIds' then
        if jsonb_typeof(o -> 'assigneeIds') <> 'array'
           or exists (select 1 from jsonb_array_elements(o -> 'assigneeIds') e
                      where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
          v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '담당자 id 가 올바르지 않아요', 'assigneeIds'); continue;
        end if;
        if v_type is distinct from 'DESIGNATED' then
          v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', '담당자는 지정 과제(designated)에만 줄 수 있어요', 'assigneeIds'); continue;
        end if;
      end if;

      -- 날짜(형식 → 기본값 → 기간)
      k := null;
      if o ? 'startDate' and o -> 'startDate' <> 'null'::jsonb and public.plan_date_try(case when jsonb_typeof(o -> 'startDate') = 'string' then o ->> 'startDate' end) is null then k := 'startDate';
      elsif o ? 'endDate' and o -> 'endDate' <> 'null'::jsonb and public.plan_date_try(case when jsonb_typeof(o -> 'endDate') = 'string' then o ->> 'endDate' end) is null then k := 'endDate';
      end if;
      if k is not null then v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '날짜는 YYYY-MM-DD 예요', k); continue; end if;
      if v_depth = 2 then
        v_s := coalesce(public.plan_date_try(o ->> 'startDate'), v_last + 1, r.start_date);
        v_e := coalesce(public.plan_date_try(o ->> 'endDate'), v_s + 6);
      else
        v_s := coalesce(public.plan_date_try(o ->> 'startDate'), v_ps);
        v_e := coalesce(public.plan_date_try(o ->> 'endDate'), v_pe);
      end if;
      if v_s > v_e then v_err := v_err || public.plan_err(f.path, 'INVALID_PERIOD', '종료일은 시작일 이후여야 해요', 'endDate'); continue; end if;

      if o ? 'index' and o -> 'index' <> 'null'::jsonb
         and (jsonb_typeof(o -> 'index') <> 'number' or (o ->> 'index')::numeric < 0 or (o ->> 'index')::numeric <> trunc((o ->> 'index')::numeric)) then
        v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', 'index 는 0 이상 정수예요', 'index'); continue;
      end if;

      -- 경고
      if v_s < r.start_date or v_e > r.end_date then
        v_warn := v_warn || public.plan_err(f.path, 'PERIOD_OUTSIDE_ROOM', '스터디 기간 밖이에요');
      end if;
      if v_depth > 2 and (v_s < v_ps or v_e > v_pe) then
        v_warn := v_warn || public.plan_err(f.path, 'PERIOD_OUTSIDE_PARENT', '상위 항목 기간 밖이에요');
      end if;

      v_info := v_info || jsonb_build_object(f.path, jsonb_build_object('depth', v_depth, 's', v_s, 'e', v_e));
      if v_depth = 2 then v_last := greatest(v_last, v_e); end if;
      continue;
    end if;

    -- (c)(d) update · move 공통: 키 · id · 대상 노드
    select key into k from jsonb_object_keys(o) key
    where key <> all (case when v_kind = 'update' then array['op', 'id', 'set'] else array['op', 'id', 'parent', 'index'] end)
    limit 1;
    if k is not null then v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', '쓸 수 없는 항목이에요', public.plan_clip(k)); continue; end if;
    v_node := null;
    if jsonb_typeof(o -> 'id') = 'string' and left(o ->> 'id', 1) = '@' then
      if v_kind = 'update' then
        v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', 'update 의 id 에는 @ref 를 쓸 수 없어요(create 에 바로 적어 주세요)', 'id'); continue;
      end if;
      if not v_refs ? substr(o ->> 'id', 2) then
        v_err := v_err || public.plan_err(f.path, 'UNKNOWN_REF', '앞선 create 에 ref 「' || public.plan_clip(substr(o ->> 'id', 2)) || '」 가 없어요', 'id'); continue;
      end if;
      if not v_info ? (v_refs ->> substr(o ->> 'id', 2)) then continue; end if;
    elsif jsonb_typeof(o -> 'id') = 'string' and (o ->> 'id') ~ '^\d{1,18}$' then
      select * into v_node from public.goal_nodes where id = (o ->> 'id')::bigint and room_id = r.id;
      if not found then
        v_err := v_err || public.plan_err(f.path, 'NODE_NOT_FOUND', '항목을 찾을 수 없어요', 'id'); continue;
      elsif v_node.task_type = 'PERSONAL' then
        v_err := v_err || public.plan_err(f.path, 'PERSONAL_NODE', '개인 목표는 진행목표 편집으로 바꿀 수 없어요', 'id'); continue;
      elsif v_node.archived_at is not null then
        if v_node.task_type is null then
          v_err := v_err || public.plan_err(f.path, 'PARENT_ARCHIVED', '보관된 항목은 바꿀 수 없어요');
        else
          v_err := v_err || public.plan_err(f.path, 'TASK_ARCHIVED', '보관된 과제는 바꿀 수 없어요');
        end if;
        continue;
      end if;
    else
      v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', 'id 는 항목 id 문자열이에요', 'id'); continue;
    end if;

    if v_kind = 'update' then
      s := o -> 'set';
      if jsonb_typeof(s) is distinct from 'object' then
        v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', 'set 은 객체여야 해요', 'set'); continue;
      end if;
      select key into k from jsonb_object_keys(s) key
      where key not in ('title', 'descriptionMd', 'startDate', 'endDate', 'label', 'taskType', 'assigneeIds', 'shiftDescendants')
      limit 1;
      if k is not null then v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '알 수 없는 항목이에요', public.plan_clip(k)); continue; end if;
      if s ? 'title' and (jsonb_typeof(s -> 'title') <> 'string' or length(trim(s ->> 'title')) not between 1 and 80) then
        v_err := v_err || public.plan_err(f.path, 'INVALID_TITLE', '제목은 1~80자예요', 'title'); continue;
      end if;
      if s ? 'descriptionMd' and (jsonb_typeof(s -> 'descriptionMd') <> 'string' or length(s ->> 'descriptionMd') > 20000) then
        v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '설명은 20,000자까지의 문자열이에요', 'descriptionMd'); continue;
      end if;
      if s ? 'label' then
        if v_node.depth <> 2 then v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '회차 라벨은 회차에만 줄 수 있어요', 'label'); continue; end if;
        if jsonb_typeof(s -> 'label') <> 'string' or length(trim(s ->> 'label')) not between 1 and 20 then
          v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '회차 라벨은 1~20자예요', 'label'); continue;
        end if;
      end if;
      if s ? 'shiftDescendants' and jsonb_typeof(s -> 'shiftDescendants') <> 'boolean' then
        v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '함께 옮길지 여부가 올바르지 않아요', 'shiftDescendants'); continue;
      end if;
      v_type := v_node.task_type;
      if s ? 'taskType' then
        if jsonb_typeof(s -> 'taskType') <> 'string' or upper(s ->> 'taskType') not in ('COMMON', 'DESIGNATED') then
          v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '과제 유형은 common 또는 designated 예요', 'taskType'); continue;
        end if;
        v_type := upper(s ->> 'taskType');
      end if;
      if s ? 'assigneeIds' then
        if jsonb_typeof(s -> 'assigneeIds') <> 'array'
           or exists (select 1 from jsonb_array_elements(s -> 'assigneeIds') e
                      where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
          v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '담당자 id 가 올바르지 않아요', 'assigneeIds'); continue;
        end if;
        if v_type is distinct from 'DESIGNATED' then
          v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', '담당자는 지정 과제(designated)에만 줄 수 있어요', 'assigneeIds'); continue;
        end if;
      end if;
      k := null;
      if s ? 'startDate' and public.plan_date_try(case when jsonb_typeof(s -> 'startDate') = 'string' then s ->> 'startDate' end) is null then k := 'startDate';
      elsif s ? 'endDate' and public.plan_date_try(case when jsonb_typeof(s -> 'endDate') = 'string' then s ->> 'endDate' end) is null then k := 'endDate';
      end if;
      if k is not null then v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '날짜는 YYYY-MM-DD 예요', k); continue; end if;
      if coalesce(public.plan_date_try(s ->> 'startDate'), v_node.start_date) > coalesce(public.plan_date_try(s ->> 'endDate'), v_node.end_date) then
        v_err := v_err || public.plan_err(f.path, 'INVALID_PERIOD', '종료일은 시작일 이후여야 해요', 'endDate'); continue;
      end if;
      continue;
    end if;

    -- move: parent(null · id · @ref) · index 필수
    v_pid := null;
    if o -> 'parent' is null or o -> 'parent' = 'null'::jsonb then
      null;
    elsif jsonb_typeof(o -> 'parent') = 'string' and left(o ->> 'parent', 1) = '@' then
      if not v_refs ? substr(o ->> 'parent', 2) then
        v_err := v_err || public.plan_err(f.path, 'UNKNOWN_REF', '앞선 create 에 ref 「' || public.plan_clip(substr(o ->> 'parent', 2)) || '」 가 없어요', 'parent'); continue;
      end if;
      if not v_info ? (v_refs ->> substr(o ->> 'parent', 2)) then continue; end if;
    elsif jsonb_typeof(o -> 'parent') = 'string' and (o ->> 'parent') ~ '^\d{1,18}$' then
      select * into v_node from public.goal_nodes where id = (o ->> 'parent')::bigint and room_id = r.id;
      if not found then
        v_err := v_err || public.plan_err(f.path, 'NODE_NOT_FOUND', '항목을 찾을 수 없어요', 'parent'); continue;
      elsif v_node.task_type = 'PERSONAL' then
        v_err := v_err || public.plan_err(f.path, 'PERSONAL_NODE', '개인 목표는 진행목표 편집으로 바꿀 수 없어요', 'parent'); continue;
      elsif v_node.archived_at is not null then
        v_err := v_err || public.plan_err(f.path, 'PARENT_ARCHIVED', '보관된 항목 아래로는 옮길 수 없어요', 'parent'); continue;
      elsif v_node.depth >= 5 then
        v_err := v_err || public.plan_err(f.path, 'NODE_DEPTH_EXCEEDED', '최대 5단계까지만 만들 수 있어요', 'parent'); continue;
      end if;
    else
      v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', 'parent 는 null·id·"@ref"·{"round": 회차} 중 하나예요', 'parent'); continue;
    end if;
    if jsonb_typeof(o -> 'index') is distinct from 'number' or (o ->> 'index')::numeric < 0
       or (o ->> 'index')::numeric <> trunc((o ->> 'index')::numeric) then
      v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', 'move 에는 0 이상 정수 index 가 필요해요', 'index'); continue;
    end if;
  end loop;
  return jsonb_build_object('errors', v_err, 'warnings', v_warn, 'nodes', v_n);
end $$;
