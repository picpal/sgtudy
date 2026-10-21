-- 0034_curriculum_plan.sql — 2026-10-19 AI 연동(MCP) 1단계: 진행목표 계획서. 배포 후 수정 금지.
-- 스펙 §5·§7·§8. 재정의: node_create ← 0024(본문을 node_create_core 로 옮김, 시그니처·GRANT 동일),
--                      notification_kinds ← 0032, notify_render ← 0032 (둘 다 MEMBER_JOINED 유지), notify_link ← 0028 (§5 — CURRICULUM_BULK_UPDATED).

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
  if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
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
      if v_txt ~ '^[0-9]{1,18}$' then
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
      if v_kind in ('update', 'move') and jsonb_typeof(v_op -> 'id') = 'string' and (v_op ->> 'id') ~ '^[0-9]{1,18}$' then
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
           case when jsonb_typeof(it) = 'object' and (it ->> 'path') ~ '^ops\[[0-9]+\]'
                     and p_map ? substring(it ->> 'path' from '^ops\[[0-9]+\]')
                then it || jsonb_build_object(
                       'path', (p_map ->> substring(it ->> 'path' from '^ops\[[0-9]+\]')) || substring(it ->> 'path' from '^ops\[[0-9]+\](.*)$'),
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
      elsif jsonb_typeof(o -> 'parent') = 'string' and (o ->> 'parent') ~ '^[0-9]{1,18}$' then
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
    elsif jsonb_typeof(o -> 'id') = 'string' and (o ->> 'id') ~ '^[0-9]{1,18}$' then
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
    elsif jsonb_typeof(o -> 'parent') = 'string' and (o ->> 'parent') ~ '^[0-9]{1,18}$' then
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

-- ───────── 4. curriculum_plan: 실행 plan_run · 초안 표 · 미리보기/적용 · 되돌리기 ─────────
-- 〔UX 재검토 D11·D17〕 미리보기(초안 저장) → 적용(previewId). 내부 헬퍼(plan_*)는 GRANT 없음, 공개 2개만 authenticated.
-- 잠금 순서: (api_invoke 의 사용자 잠금) → 방(node_assert_editable = room_lock) → 초안(for update). replay 판정은 잠금 뒤.

create or replace function public.plan_kind(n public.goal_nodes) returns text
language sql immutable set search_path = '' as $$
  select case when n.task_type = 'PERSONAL' then 'personal' when n.depth = 2 then 'round'
              when n.task_type is null then 'bundle' else 'task' end
$$;

-- 바뀐 필드만 [옛, 새]. 설명은 true 만(본문 비노출). 〔P4〕 담당은 여기서 내지 않는다 — plan_run 이 닉네임 [옛, 새] 로 붙인다(uuid 비노출)
create or replace function public.plan_changes(b public.goal_nodes, a public.goal_nodes, p_set jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'title',     case when a.title is distinct from b.title then jsonb_build_array(b.title, a.title) end,
    'label',     case when a.label is distinct from b.label then jsonb_build_array(b.label, a.label) end,
    'startDate', case when a.start_date <> b.start_date then jsonb_build_array(to_char(b.start_date, 'YYYY-MM-DD'), to_char(a.start_date, 'YYYY-MM-DD')) end,
    'endDate',   case when a.end_date <> b.end_date then jsonb_build_array(to_char(b.end_date, 'YYYY-MM-DD'), to_char(a.end_date, 'YYYY-MM-DD')) end,
    'taskType',  case when a.task_type is distinct from b.task_type then jsonb_build_array(lower(b.task_type), lower(a.task_type)) end,
    'descriptionMd', case when a.description_md is distinct from b.description_md then 'true'::jsonb end))
$$;

-- 〔P4〕 과제의 현재(미해제) 담당 닉네임, 닉네임 순
create or replace function public.plan_nicks(p_node bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(p.nickname order by p.nickname), '[]'::jsonb)
  from public.task_assignments a join public.profiles p on p.id = a.user_id
  where a.node_id = p_node and a.released_at is null
$$;

-- 실행 오류 → {path, code, message, …hint}. 업무 오류(P0001 + 코드)만 내용을 싣고 그 밖은 INTERNAL(원문 비노출).
-- hint 의 userId 는 뺀다(응답에 uuid 없음 — 방 밖 사용자 존재 여부도 드러내지 않는다)
create or replace function public.plan_runtime_err(p_path text, p_state text, p_code text, p_detail text, p_hint text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_h jsonb;
begin
  if p_state = 'P0001' and p_code ~ '^[A-Z][A-Z0-9_]*$' then
    begin v_h := nullif(p_hint, '')::jsonb; exception when others then v_h := null; end;
    if jsonb_typeof(v_h) is distinct from 'object' then v_h := '{}'::jsonb; end if;
    return (v_h - 'path' - 'code' - 'message' - 'userId') || jsonb_build_object('path', p_path, 'code', p_code, 'message', coalesce(p_detail, p_code));
  end if;
  return jsonb_build_object('path', p_path, 'code', 'INTERNAL', 'message', '처리 중 오류가 났어요');   -- 원문 비노출
end $$;

-- 〔C#9〕 node_update 경고({code,nodeId})에 붙일 한국어 문구 (TS WARN_TEXT 와 같은 3개)
create or replace function public.plan_warn_text(p_code text) returns text
language sql immutable set search_path = '' as $$
  select case p_code
    when 'PERIOD_OUTSIDE_ROOM'   then '스터디 기간 밖이에요'
    when 'PERIOD_OUTSIDE_PARENT' then '상위 항목 기간 밖이에요'
    when 'UNASSIGNED_TASK'       then '담당자가 없는 지정 과제예요'
    else p_code end
$$;

create table public.api_plan_drafts (
  id             varchar(16) primary key,                 -- 'pv_' + 12 hex
  user_id        uuid        not null references public.profiles(id) on delete cascade,
  room_id        bigint      not null references public.rooms(id) on delete cascade,
  plan           jsonb       not null,                    -- 원본(사용자가 보낸 것, undo 면 {"undoOf": id})
  resolved       jsonb       not null,                    -- 정규(plan_resolve 결과, undo 면 {"restore": sched_changes})
  path_map       jsonb       not null default '{}'::jsonb,
  version        char(32)    not null,                    -- 미리보기 때 curriculum_version
  preview        jsonb       not null,
  created_at     timestamptz not null,
  expires_at     timestamptz not null,
  applied_at     timestamptz,
  apply_response jsonb,
  undo_of        varchar(16),
  sched_changes  jsonb                                     -- 〔C#4·N1·N2〕 적용 때 실제로 날짜가 바뀐 기존 노드 {id:[옛시작,옛끝,새시작,새끝]}
);
create index ix_api_plan_drafts_user on public.api_plan_drafts (user_id, created_at desc);
alter table public.api_plan_drafts enable row level security;   -- 정책 없음: RPC 전용

-- 〔N1〕 기록된 노드가 지금도 '새 값' 그대로인가. 다르거나 없어진 id(≤20) — 빈 배열이면 통과. 예외 없음
create or replace function public.plan_undo_check(p_changes jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(z.k), '[]'::jsonb) from (
    select e.k from jsonb_each(case when jsonb_typeof(p_changes) = 'object' then p_changes else '{}'::jsonb end) e(k, v)
    left join public.goal_nodes g on g.id = e.k::bigint
    where g.id is null or jsonb_build_array(g.start_date, g.end_date) <> jsonb_build_array(e.v -> 2, e.v -> 3)
    order by e.k::bigint limit 20) z
$$;

-- 정규 계획서 실행(원안 ⑥~⑧). 서브트랜잭션: dry 면 결과를 만든 뒤 되감는다(plpgsql 변수 v_out 은 남는다).
-- 실행 오류: dry → {ok:false, errors:[…]}, 적용 → 재발생(호출자 전체 롤백).
-- 반환 {ok, summary, diff, warnings, errors, notifications, ids{path→id}, refs{ref→id}, sched}. dry 면 diff 의 생성 id null, ids·refs 비움.
-- 〔N2〕 sched = 이 실행에서 날짜가 실제로 바뀐 기존 노드 {id:[옛s,옛e,새s,새e]} — 이 계획이 만든 노드는 제외, 옛 값은 처음 것, 새 값은 최종 행.
create or replace function public.plan_run(r public.rooms, p_uid uuid, p_plan jsonb, p_dry boolean, p_warn jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_slug     text := r.slug;
  v_uid      uuid := p_uid;
  v_dry      boolean := coalesce(p_dry, true);
  v_after_id bigint;
  f          record;
  o          jsonb;
  v_cur      text;
  v_refs     jsonb := '{}'::jsonb;   -- ref → path
  v_ids      jsonb := '{}'::jsonb;   -- path → id (create)
  v_dm       jsonb := '{}'::jsonb;   -- path → diff 항목
  v_diff     jsonb;
  v_warn     jsonb := '[]'::jsonb;   -- 실행 중 경고(node_update)
  v_notes    jsonb;
  v_parent   bigint;
  v_id       bigint;
  v_res      jsonb;
  v_chg      jsonb;
  v_nb       jsonb;                  -- 〔P4〕 담당 닉네임(전)
  v_na       jsonb;                  --        (후)
  b          public.goal_nodes;
  a          public.goal_nodes;
  v_created  int := 0;
  v_updated  int := 0;
  v_moved    int := 0;
  v_shift    int := 0;
  v_sched    jsonb := '{}'::jsonb;   -- 〔N2〕 실제 날짜 변경 {id:[옛s,옛e,새s,새e]}
  v_pre      jsonb;
  v_out      jsonb;
  v_state    text;
  v_code     text;
  v_msg      text;
  v_hint     text;
  v_e        jsonb;
begin
  select coalesce(max(id), 0) into v_after_id from public.notifications;      -- ⑥ (Task 5 알림 묶기 기준점)
  begin                                                                       -- ⑦ 서브트랜잭션
    for f in select * from public.plan_flatten(p_plan) loop
      v_cur := f.path;
      o := f.op;
      if o ? 'ref' then v_refs := v_refs || jsonb_build_object(o ->> 'ref', f.path); end if;
      case coalesce(o ->> 'op', 'create')
        when 'create' then
          v_parent := case
            when f.parent_path is not null then (v_ids ->> f.parent_path)::bigint
            when jsonb_typeof(o -> 'parent') = 'string' and left(o ->> 'parent', 1) = '@'
              then (v_ids ->> (v_refs ->> substr(o ->> 'parent', 2)))::bigint
            else (o ->> 'parent')::bigint end;
          v_id := public.node_create_core(r, v_uid, v_parent, o ->> 'title', o ->> 'label', o ->> 'taskType',
                    public.plan_date_try(o ->> 'startDate'), public.plan_date_try(o ->> 'endDate'),
                    (o ->> 'index')::int, coalesce(o ->> 'descriptionMd', ''));
          v_ids := v_ids || jsonb_build_object(f.path, v_id);
          if o ? 'assigneeIds' then
            perform public.node_update(v_slug, v_id, jsonb_build_object('assigneeIds', o -> 'assigneeIds'));
          end if;
        when 'update' then
          v_id := (o ->> 'id')::bigint;                                       -- update 의 id 는 @ref 불가(plan_validate)
          select * into b from public.goal_nodes where id = v_id;
          v_nb := case when (o -> 'set') ? 'assigneeIds' then public.plan_nicks(v_id) end;
          -- 〔N2〕 node_update 가 옮길 수 있는 범위(자기 + 하위, 개인 목표 포함)의 날짜를 앞뒤로 비교
          select coalesce(jsonb_object_agg(g.id::text, jsonb_build_array(g.start_date, g.end_date)), '{}'::jsonb) into v_pre
          from public.goal_nodes g where g.id in (select public.node_subtree(v_id));
          v_res := public.node_update(v_slug, v_id, o -> 'set');
          select v_sched || coalesce(jsonb_object_agg(g.id::text, jsonb_build_array(
                   coalesce(v_sched -> g.id::text -> 0, v_pre -> g.id::text -> 0),    -- 옛 값은 처음 것
                   coalesce(v_sched -> g.id::text -> 1, v_pre -> g.id::text -> 1),
                   g.start_date, g.end_date)), '{}'::jsonb) into v_sched
          from public.goal_nodes g
          where g.id in (select public.node_subtree(v_id)) and v_pre ? g.id::text
            and jsonb_build_array(g.start_date, g.end_date) <> v_pre -> g.id::text
            and not exists (select 1 from jsonb_each_text(v_ids) c where c.value::bigint = g.id);   -- 이 계획이 만든 노드 제외
          select * into a from public.goal_nodes where id = v_id;
          v_shift := v_shift + coalesce((v_res #>> '{shifted,tasks}')::int, 0) + coalesce((v_res #>> '{shifted,groups}')::int, 0)
                             + coalesce((v_res #>> '{shifted,personal}')::int, 0);
          v_warn := v_warn || coalesce((select jsonb_agg(w || jsonb_build_object('path', f.path,      -- 〔C#9〕 message 보강
                                          'message', coalesce(w ->> 'message', public.plan_warn_text(w ->> 'code'))))
                                        from jsonb_array_elements(v_res -> 'warnings') w), '[]'::jsonb);
          v_chg := public.plan_changes(b, a, o -> 'set');
          if v_nb is not null then
            v_na := public.plan_nicks(v_id);
            if v_na <> v_nb then v_chg := v_chg || jsonb_build_object('assignees', jsonb_build_array(v_nb, v_na)); end if;
          end if;
          v_dm := v_dm || jsonb_build_object(f.path, jsonb_build_object('path', f.path, 'op', 'update', 'id', v_id::text,
                    'kind', public.plan_kind(a), 'title', a.title, 'changes', v_chg));
          v_updated := v_updated + 1;
        when 'move' then
          v_id := case when jsonb_typeof(o -> 'id') = 'string' and left(o ->> 'id', 1) = '@'          -- move 의 id 는 @ref 가능
                         then (v_ids ->> (v_refs ->> substr(o ->> 'id', 2)))::bigint
                       else (o ->> 'id')::bigint end;
          v_parent := case when jsonb_typeof(o -> 'parent') = 'string' and left(o ->> 'parent', 1) = '@'
                             then (v_ids ->> (v_refs ->> substr(o ->> 'parent', 2)))::bigint
                           else (o ->> 'parent')::bigint end;
          select * into b from public.goal_nodes where id = v_id;
          perform public.node_move(v_slug, v_id, v_parent, (o ->> 'index')::int);
          select * into a from public.goal_nodes where id = v_id;
          v_dm := v_dm || jsonb_build_object(f.path, jsonb_build_object('path', f.path, 'op', 'move',
                    'id', case when v_dry and left(o ->> 'id', 1) = '@' then null else v_id::text end,   -- 되감길 임시 id 비노출
                    'ref', case when left(o ->> 'id', 1) = '@' then substr(o ->> 'id', 2) end,
                    'kind', public.plan_kind(a), 'title', a.title, 'parent', o -> 'parent', 'index', (o ->> 'index')::int,
                    'from', jsonb_build_object('parentId', case when v_dry and exists (select 1 from jsonb_each_text(v_ids) c where c.value::bigint = b.parent_id)
                                                                then null else b.parent_id::text end, 'index', b.sort_order)));
          v_moved := v_moved + 1;
      end case;
    end loop;
    v_cur := null;
    -- 〔N2〕 새 값을 최종 행으로 갱신하고, 계획 안에서 원위치된 항목은 뺀다
    select coalesce(jsonb_object_agg(e.k, jsonb_build_array(e.v -> 0, e.v -> 1, g.start_date, g.end_date)), '{}'::jsonb) into v_sched
    from jsonb_each(v_sched) e(k, v) join public.goal_nodes g on g.id = e.k::bigint
    where jsonb_build_array(g.start_date, g.end_date) <> jsonb_build_array(e.v -> 0, e.v -> 1);
    perform public.assignment_resync(r.id);
    v_notes := '{"recipients":0,"perRecipient":[]}'::jsonb;   -- Task 5 에서 plan_collapse_notifications(r.id, v_uid, v_after_id, <v_ids 의 id 배열>) 로 교체
    -- create diff: 최종 상태로(리프 → 묶음 전환 반영). dry-run 이면 id null(되감긴 임시 id 비노출), 새 부모는 parentPath. 〔P4〕 지정 과제는 담당 닉네임
    for f in select * from public.plan_flatten(p_plan) x where coalesce(x.op ->> 'op', 'create') = 'create' loop
      select * into a from public.goal_nodes where id = (v_ids ->> f.path)::bigint;
      v_dm := v_dm || jsonb_build_object(f.path, jsonb_build_object('path', f.path, 'op', 'create', 'ref', f.op ->> 'ref',
        'id', case when v_dry then null else a.id::text end, 'kind', public.plan_kind(a), 'title', a.title, 'label', a.label,
        'taskType', lower(a.task_type), 'startDate', to_char(a.start_date, 'YYYY-MM-DD'), 'endDate', to_char(a.end_date, 'YYYY-MM-DD'),
        'parent', case when f.parent_path is null and left(coalesce(f.op ->> 'parent', ''), 1) <> '@' then f.op ->> 'parent' end,
        'parentPath', coalesce(f.parent_path, case when left(f.op ->> 'parent', 1) = '@' then v_refs ->> substr(f.op ->> 'parent', 2) end))
        || case when a.task_type = 'DESIGNATED' then jsonb_build_object('assignees', public.plan_nicks(a.id)) else '{}'::jsonb end);
      v_created := v_created + 1;
    end loop;
    select coalesce(jsonb_agg(v_dm -> x.path order by x.seq), '[]'::jsonb) into v_diff
    from public.plan_flatten(p_plan) x where v_dm ? x.path;
    v_out := jsonb_build_object('ok', true,
      'summary', jsonb_build_object('created', v_created, 'updated', v_updated, 'moved', v_moved, 'restored', 0, 'shiftedDescendants', v_shift),
      'diff', v_diff, 'warnings', coalesce(p_warn, '[]'::jsonb) || v_warn, 'errors', '[]'::jsonb, 'notifications', v_notes,
      'ids', v_ids, 'sched', v_sched,
      'refs', coalesce((select jsonb_object_agg(k, v_ids ->> (v_refs ->> k)) from jsonb_object_keys(v_refs) k), '{}'::jsonb));
    if v_dry then raise exception using errcode = 'P0001', message = 'PLAN_DRY_RUN'; end if;
  exception when others then                                                  -- ⑧
    get stacked diagnostics v_state = returned_sqlstate, v_code = message_text, v_msg = pg_exception_detail, v_hint = pg_exception_hint;
    if v_code = 'PLAN_DRY_RUN' and v_state = 'P0001' then
      v_out := v_out || '{"ids": {}, "refs": {}}'::jsonb;                     -- 되감김 — 임시 id 비노출
    elsif v_dry then
      return jsonb_build_object('ok', false, 'diff', '[]'::jsonb, 'warnings', coalesce(p_warn, '[]'::jsonb),
        'errors', jsonb_build_array(public.plan_runtime_err(v_cur, v_state, v_code, v_msg, v_hint)), 'notifications', null);
    else
      v_e := public.plan_runtime_err(v_cur, v_state, v_code, v_msg, v_hint);
      raise exception using errcode = 'P0001', message = v_e ->> 'code', detail = v_e ->> 'message', hint = (v_e - 'code' - 'message')::text;
    end if;
  end;
  return v_out;
end $$;

-- 〔C#4·N1·N2〕 되돌리기 = 기록된 날짜 복원. 역계획을 node_update(shiftDescendants)로 다시 돌리지 않는다 — 그건 *현재* 하위를 옮기므로
-- 그 사이 옮겨 나간 자식은 놓치고 새로 생긴 자식은 끌고 간다. 기록된 id 만 옛 날짜로(개인 목표 포함, 새 노드·다른 노드 불변).
-- 반환은 plan_run 과 같은 모양. sched = 복원의 역(undo 의 undo = 다시 적용). dry 면 되감는다.
create or replace function public.plan_undo_run(r public.rooms, p_uid uuid, p_changes jsonb, p_dry boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_diff  jsonb;
  v_sched jsonb;
  v_notes jsonb := '{"recipients":0,"perRecipient":[]}'::jsonb;
  v_list  jsonb := '[]'::jsonb;
  v_out   jsonb;
  g       record;
begin
  begin                                                                        -- 서브트랜잭션(dry 면 되감기)
    select coalesce(jsonb_agg(jsonb_build_object('path', 'undo', 'op', 'restore', 'id', n.id::text, 'kind', public.plan_kind(n), 'title', n.title,
             'changes', jsonb_strip_nulls(jsonb_build_object(
               'startDate', case when n.start_date <> (e.v ->> 0)::date then jsonb_build_array(to_char(n.start_date, 'YYYY-MM-DD'), e.v ->> 0) end,
               'endDate',   case when n.end_date   <> (e.v ->> 1)::date then jsonb_build_array(to_char(n.end_date, 'YYYY-MM-DD'), e.v ->> 1) end)))
             order by n.depth, n.id), '[]'::jsonb),
           coalesce(jsonb_object_agg(n.id::text, jsonb_build_array(n.start_date, n.end_date, e.v -> 0, e.v -> 1)), '{}'::jsonb)
      into v_diff, v_sched
    from jsonb_each(p_changes) e(k, v) join public.goal_nodes n on n.id = e.k::bigint and n.room_id = r.id;
    update public.goal_nodes n set start_date = (e.v ->> 0)::date, end_date = (e.v ->> 1)::date, updated_at = now()
    from jsonb_each(p_changes) e(k, v) where n.id = e.k::bigint and n.room_id = r.id;
    perform public.assignment_resync(r.id);
    if r.status = 'ACTIVE' then                                                -- 〔P5〕 일정 알림은 진행중 방만. 수신자당 1건
      for g in
        select x.user_id, count(*)::int as c from (
          select a.user_id from public.task_assignments a join public.goal_nodes n on n.id = a.node_id
          where a.released_at is null and n.room_id = r.id and a.node_id in (select k::bigint from jsonb_object_keys(p_changes) k)
          union all
          select n.owner_id from public.goal_nodes n
          where n.task_type = 'PERSONAL' and n.room_id = r.id and n.id in (select k::bigint from jsonb_object_keys(p_changes) k)) x
        where x.user_id <> p_uid group by x.user_id order by x.user_id
      loop
        perform public.notify_publish('CURRICULUM_BULK_UPDATED', r.id, null, p_uid, array[g.user_id],
          'CURRICULUM_BULK_UPDATED:' || r.id || ':' || txid_current(), jsonb_build_object('newTasks', 0, 'schedule', g.c, 'assign', 0));
        v_list := v_list || jsonb_build_object('nickname', (select nickname from public.profiles where id = g.user_id),
                                               'count', g.c, 'newTasks', 0, 'collapsed', true);
      end loop;
      v_notes := jsonb_build_object('recipients', jsonb_array_length(v_list), 'perRecipient', v_list);
    end if;
    v_out := jsonb_build_object('ok', true,
      'summary', jsonb_build_object('created', 0, 'updated', 0, 'moved', 0, 'restored', jsonb_array_length(v_diff), 'shiftedDescendants', 0),
      'diff', v_diff, 'warnings', '[]'::jsonb, 'errors', '[]'::jsonb, 'notifications', v_notes,
      'ids', '{}'::jsonb, 'refs', '{}'::jsonb, 'sched', v_sched);
    if coalesce(p_dry, true) then raise exception using errcode = 'P0001', message = 'PLAN_DRY_RUN'; end if;
  exception when others then
    if sqlstate <> 'P0001' or sqlerrm <> 'PLAN_DRY_RUN' then raise; end if;     -- 되감기만 삼킨다
  end;
  return v_out;
end $$;

-- 공개: 미리보기(초안 저장). 검증·실행 오류는 {ok:false, errors}(초안 없음). 스펙 §7.2 미리보기 응답.
create or replace function public.curriculum_plan_preview(p_slug text, p_plan jsonb, p_undo_of text default null)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '15s' as $$
declare
  r      public.rooms;
  v_uid  uuid;
  v_src  jsonb := p_plan;
  v_shp  jsonb;
  v_res  jsonb;
  v_val  jsonb;
  v_ver  text;
  v_run  jsonb;
  v_id   text;
  u      public.api_plan_drafts;
  v_bad  jsonb;
begin
  r := public.node_assert_editable(p_slug);                                    -- ① 방 잠금 먼저(잠금 순서)
  v_uid := public.current_user_id();
  if p_undo_of is not null then                                                -- ② undo 분기 〔C#4·N1·N2〕(p_plan 무시)
    select * into u from public.api_plan_drafts x
    where x.id = p_undo_of and x.user_id = v_uid and x.room_id = r.id and x.applied_at is not null;
    if not found then perform public.fail('PREVIEW_NOT_FOUND', '되돌릴 적용 기록을 찾을 수 없어요'); end if;
    if coalesce(u.sched_changes, '{}'::jsonb) = '{}'::jsonb then
      perform public.fail('NOTHING_TO_UNDO', '되돌릴 수 있는 일정 변경이 없어요. 이동·새 항목·제목 변경은 웹에서 고쳐 주세요');
    end if;
    v_bad := public.plan_undo_check(u.sched_changes);
    if jsonb_array_length(v_bad) > 0 then
      perform public.fail('UNDO_STALE', '적용한 뒤에 그 일정이 다시 바뀌어서 되돌릴 수 없어요(이미 되돌렸거나 다른 수정). 웹에서 고쳐 주세요',
        jsonb_build_object('nodeIds', v_bad));
    end if;
    v_run := public.plan_undo_run(r, v_uid, u.sched_changes, true);
    v_ver := public.curriculum_version(r.id);
    v_id := 'pv_' || left(replace(gen_random_uuid()::text, '-', ''), 12);
    v_run := (v_run - 'ids' - 'refs' - 'sched') || jsonb_build_object('previewId', v_id, 'version', v_ver,
               'expiresAt', public.iso(public.app_now() + interval '24 hours'),
               'undoable', jsonb_build_object('ops', jsonb_array_length(v_run -> 'diff'),
                             'notUndoable', '{"created":0,"moved":0,"otherChanges":0}'::jsonb),
               'undoOf', p_undo_of);
    insert into public.api_plan_drafts (id, user_id, room_id, plan, resolved, path_map, version, preview, created_at, expires_at, undo_of)
    values (v_id, v_uid, r.id, jsonb_build_object('undoOf', p_undo_of), jsonb_build_object('restore', u.sched_changes), '{}'::jsonb,
            v_ver, v_run, public.app_now(), public.app_now() + interval '24 hours', p_undo_of);
    delete from public.api_plan_drafts x where x.id in (                         -- 〔P13〕 일반 분기와 같은 정리
      select y.id from public.api_plan_drafts y where y.user_id = v_uid and y.applied_at is null order by y.created_at desc offset 50);
    return v_run;
  end if;
  v_shp := public.plan_shape_check(v_src);                                     -- ③ 〔C#11〕 해석 전에 원본의 크기·깊이·형태 거부
  if v_shp is not null then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(v_shp), 'warnings', '[]'::jsonb);
  end if;
  v_res := public.plan_resolve(r, v_src);                                      -- ④ 이름 해석·shift 펼치기(오류는 원래 경로)
  if jsonb_array_length(v_res -> 'errors') > 0 then
    return jsonb_build_object('ok', false, 'errors', v_res -> 'errors', 'warnings', '[]'::jsonb);
  end if;
  v_ver := public.curriculum_version(r.id);                                    -- ⑤
  if jsonb_typeof(v_src) = 'object' and nullif(v_src ->> 'baseVersion', '') is not null and v_src ->> 'baseVersion' <> v_ver then
    perform public.fail('STALE_VERSION', '그 사이 진행목표가 바뀌었어요. 다시 읽고 미리 봐 주세요', jsonb_build_object('current', v_ver));
  end if;
  v_val := public.plan_validate(r, v_res -> 'plan');                           -- ⑥ 정규 계획서 정적 검증 → 원래 경로로
  if jsonb_array_length(v_val -> 'errors') > 0 then
    return jsonb_build_object('ok', false, 'errors', public.plan_map_paths(v_val -> 'errors', v_res -> 'map'),
                              'warnings', public.plan_map_paths(v_val -> 'warnings', v_res -> 'map'));
  end if;
  v_run := public.plan_run(r, v_uid, v_res -> 'plan', true, v_val -> 'warnings');   -- ⑦ dry-run(되감김)
  if not (v_run ->> 'ok')::boolean then
    return v_run || jsonb_build_object('errors', public.plan_map_paths(v_run -> 'errors', v_res -> 'map'),
                                       'warnings', public.plan_map_paths(v_run -> 'warnings', v_res -> 'map'));
  end if;
  v_id := 'pv_' || left(replace(gen_random_uuid()::text, '-', ''), 12);         -- ⑧ 되감은 뒤 초안 저장
  v_run := (v_run - 'ids' - 'refs' - 'sched') || jsonb_build_object('previewId', v_id, 'version', v_ver,
             'expiresAt', public.iso(public.app_now() + interval '24 hours'),
             'diff', public.plan_map_paths(v_run -> 'diff', v_res -> 'map'),
             'warnings', public.plan_map_paths(v_run -> 'warnings', v_res -> 'map'),
             'undoable', jsonb_build_object(                                   -- 〔C#4·N2〕 날짜가 실제로 바뀌는 기존 노드 수(하위·개인 목표 포함)
               'ops', (select count(*) from jsonb_object_keys(coalesce(v_run -> 'sched', '{}'::jsonb))),
               'notUndoable', jsonb_build_object(
                 'created', (v_run #>> '{summary,created}')::int,
                 'moved',   (v_run #>> '{summary,moved}')::int,
                 'otherChanges', (select count(*) from jsonb_array_elements(v_run -> 'diff') e
                                  where e ->> 'op' = 'update' and e -> 'changes' ?| array['title', 'label', 'taskType', 'descriptionMd', 'assignees']))),
             'undoOf', null);
  insert into public.api_plan_drafts (id, user_id, room_id, plan, resolved, path_map, version, preview, created_at, expires_at, undo_of)
  values (v_id, v_uid, r.id, coalesce(v_src, '{}'::jsonb), v_res -> 'plan', coalesce(v_res -> 'map', '{}'::jsonb), v_ver, v_run,
          public.app_now(), public.app_now() + interval '24 hours', null);
  delete from public.api_plan_drafts x where x.id in (                           -- 내 미적용 초안 50개 초과분(오래된 것부터)
    select y.id from public.api_plan_drafts y where y.user_id = v_uid and y.applied_at is null order by y.created_at desc offset 50);
  return v_run;                                                                -- ⑨
end $$;

-- 공개: 적용(previewId). 잠금 순서 방 → 초안. 같은 previewId 재적용은 저장 응답 + replayed(재실행 없음).
create or replace function public.curriculum_plan_apply(p_slug text, p_preview_id text)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '15s' as $$
declare
  r     public.rooms;
  v_uid uuid;
  d     public.api_plan_drafts;
  v_run jsonb;
  v_out jsonb;
  v_bad jsonb;
begin
  r := public.node_assert_editable(p_slug);                                    -- ① 방 잠금 먼저
  v_uid := public.current_user_id();
  select * into d from public.api_plan_drafts x
  where x.id = p_preview_id and x.user_id = v_uid and x.room_id = r.id for update;   -- ② 초안 잠금(나·이 방)
  if not found then perform public.fail('PREVIEW_NOT_FOUND', '미리보기를 찾을 수 없어요. preview_curriculum_plan 으로 다시 미리 봐 주세요'); end if;
  if d.applied_at is not null then return d.apply_response || '{"replayed": true}'::jsonb; end if;   -- ③ 잠금 뒤 replay 판정
  if d.expires_at <= public.app_now() then                                     -- ④
    perform public.fail('PREVIEW_EXPIRED', '미리보기가 만료됐어요(24시간). 다시 미리 봐 주세요');
  end if;
  if d.undo_of is not null then                                                -- ⑤ 〔N1〕 undo: 방 잠금 안에서 기록 노드 재확인
    v_bad := public.plan_undo_check(d.resolved -> 'restore');                  --    (개인 목표 변경은 버전에 안 잡힌다 — 정확 일치로 본다)
    if jsonb_array_length(v_bad) > 0 then
      perform public.fail('UNDO_STALE', '미리본 뒤에 그 일정이 바뀌어서 되돌릴 수 없어요. 다시 되돌리기 미리보기를 해 주세요',
        jsonb_build_object('nodeIds', v_bad));
    end if;
    v_run := public.plan_undo_run(r, v_uid, d.resolved -> 'restore', false);    -- ⑥
  else
    if public.curriculum_version(r.id) <> d.version then                       -- ⑤
      perform public.fail('STALE_VERSION', '미리본 뒤에 진행목표가 바뀌었어요. 같은 계획으로 다시 미리 봐 주세요',
        jsonb_build_object('current', public.curriculum_version(r.id)));
    end if;
    v_run := public.plan_run(r, v_uid, d.resolved, false, '[]'::jsonb);        -- ⑥ 실패하면 예외 → 이 함수 전체(앞 op 포함) 롤백
  end if;
  v_out := jsonb_build_object('ok', true, 'applied', true, 'previewId', d.id, 'version', public.curriculum_version(r.id),
    'summary', v_run -> 'summary', 'refs', v_run -> 'refs',
    'createdIds', coalesce((select jsonb_agg(x.value order by x.value::bigint) from jsonb_each_text(v_run -> 'ids') x), '[]'::jsonb),   -- 〔P13〕 생성 순서
    'notifications', v_run -> 'notifications', 'link', '/my-study/' || r.slug || '?tab=curriculum',
    'undoable', d.preview -> 'undoable');                                      -- 〔C#9〕 formatApply 계약
  update public.api_plan_drafts set applied_at = public.app_now(), apply_response = v_out,   -- ⑦
         sched_changes = nullif(v_run -> 'sched', '{}'::jsonb)                  -- 〔N2〕 실제 적용에서 바뀐 날짜(미리보기 값 아님)
  where id = d.id;
  return v_out;
end $$;

grant execute on function public.curriculum_plan_preview(text, jsonb, text) to authenticated;
grant execute on function public.curriculum_plan_apply(text, text)          to authenticated;

-- ───────── 5. 알림 종류 CURRICULUM_BULK_UPDATED (plan_undo_run 이 발행 — Task 5 의 알림 묶기도 같은 종류) ─────────
-- 재정의: notification_kinds ← 0032 · notify_render ← 0032 (MEMBER_JOINED 유지) · notify_link ← 0028. 시그니처 동일 → GRANT(없음) 유지.
-- notify_enabled 는 그대로(else true).
-- notification_kinds (0032 판 그대로 + CURRICULUM_BULK_UPDATED — MEMBER_JOINED 유지)
create or replace function public.notification_kinds() returns text[]
language sql immutable set search_path = '' as $$
  select array['ROUND_STARTED', 'TASK_ALL_SUBMITTED', 'TASK_COMPLETION_DIGEST', 'JOIN_REQUESTED', 'JOIN_APPROVED', 'JOIN_REJECTED',
               'JOIN_EXPIRED', 'DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'SCHEDULE_CHANGED', 'ROOM_STARTED',
               'ROOM_ENDED', 'ROOM_START_BLOCKED', 'MEMBER_DEACTIVATED',
               'CURRICULUM_EDITOR_GRANTED', 'CURRICULUM_EDITOR_REVOKED', 'ROOM_PERIOD_CHANGED',
               -- 0024
               'ROUND_SCHEDULE_CHANGED', 'ROOM_ARCHIVED', 'PERSONAL_ARCHIVED', 'LEAVE_REQUESTED', 'LEAVE_REQUEST_DISMISSED', 'SUBMISSION_DIGEST'
               -- 0032
               , 'MEMBER_JOINED'
               -- 0034
               , 'CURRICULUM_BULK_UPDATED']
$$;

-- notify_render (0032 판 그대로 + CURRICULUM_BULK_UPDATED 제목·본문 — MEMBER_JOINED 유지)
create or replace function public.notify_render(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_model jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_room  text;
  v_node  text;
  v_label text;
  v_actor text;
  v_title text;
  v_body  text;
  v_today date := public.kst_today();   -- 0024: 표기 기준(알림 생성일). format.ts 의 today 와 같은 역할
  v_os    date;   -- 0023 SCHEDULE_CHANGED·0024 ROUND_SCHEDULE_CHANGED: 옛 시작·마감, 새 시작·마감
  v_oe    date;
  v_ns    date;
  v_ne    date;
  v_diff  text;
  v_tasks int;
begin
  select title into v_room from public.rooms where id = p_room;
  select title, label into v_node, v_label from public.goal_nodes where id = p_node;
  select coalesce(nickname, '') into v_actor from public.profiles where id = p_actor;
  v_title := case p_kind
    when 'ROUND_STARTED'          then format('%s의 %s가 시작됐어요', v_room, coalesce(v_label, v_node))
    when 'TASK_ALL_SUBMITTED'     then format('"%s" 과제를 전원 제출했어요', v_node)
    when 'TASK_COMPLETION_DIGEST' then format('어제 %s개 과제가 전원 제출됐어요', coalesce(p_model ->> 'count', '0'))
    when 'JOIN_REQUESTED'         then format('%s님이 %s 참가를 신청했어요', v_actor, v_room)
    when 'JOIN_APPROVED'          then format('%s 참가가 승인됐어요', v_room)
    when 'JOIN_REJECTED'          then format('%s 참가 신청이 거절됐어요', v_room)
    when 'JOIN_EXPIRED'           then format('%s 참가 신청이 만료됐어요', v_room)
    when 'DEADLINE_REMINDER'      then format('"%s" 마감 %s일 전이에요', v_node, coalesce(p_model ->> 'days', '1'))
    when 'TASK_ASSIGNED'          then format('"%s" 과제 담당자로 지정됐어요', v_node)
    when 'TASK_UNASSIGNED'        then format('"%s" 과제 담당에서 제외됐어요', v_node)
    when 'SCHEDULE_CHANGED'       then format('%s 일정이 변경됐어요', v_room)
    when 'ROOM_STARTED'           then format('%s 스터디가 시작됐어요', v_room)
    when 'ROOM_ENDED'             then format('%s 스터디가 종료됐어요', v_room)
    when 'ROOM_START_BLOCKED'     then format('%s 시작일이 지났지만 말단 과제가 없어 시작하지 못했어요', v_room)
    when 'MEMBER_DEACTIVATED'     then format('%s 스터디에서 이탈 처리됐어요', v_room)
    when 'CURRICULUM_EDITOR_GRANTED' then '진행목표 편집 권한을 받았어요'
    when 'CURRICULUM_EDITOR_REVOKED' then '진행목표 편집 권한이 회수됐어요'
    when 'ROOM_PERIOD_CHANGED'    then format('%s 기간이 변경됐어요', v_room)
    -- 0024
    when 'ROUND_SCHEDULE_CHANGED' then format('%s 회차 일정이 변경됐어요', v_room)
    when 'ROOM_ARCHIVED'          then format('%s 스터디가 보관됐어요', v_room)
    when 'PERSONAL_ARCHIVED'      then format('그룹장이 "%s" 개인 목표를 보관했어요', v_node)
    when 'LEAVE_REQUESTED'        then format('%s님이 %s 탈퇴를 요청했어요', v_actor, v_room)
    when 'LEAVE_REQUEST_DISMISSED' then format('%s 탈퇴 요청이 반려됐어요', v_room)
    when 'SUBMISSION_DIGEST'      then format('어제 제출 %s건이 들어왔어요', coalesce(p_model ->> 'count', '0'))
    -- 0032
    when 'MEMBER_JOINED'          then format('%s님이 %s에 합류했어요', v_actor, v_room)
    -- 0034: 계획 적용·되돌리기 묶음(수신자당 1건). 방 제목은 따옴표 없이
    when 'CURRICULUM_BULK_UPDATED' then format('%s 진행목표가 한꺼번에 바뀌었어요', v_room)
  end;
  -- 본문(0013): 방 제목은 프론트가 메타 줄에 따로 그리므로 본문에 넣지 않는다. 제목에 없는 정보만.
  -- 일정 변경(0023)·회차 일정 변경(0024): 바뀐 쪽만 — 마감만 '마감 옛 → 새', 시작만 '시작 옛 → 새', 둘 다 '기간 옛 범위 → 새 범위'.
  -- 날짜(0024): notify_date/notify_range — 0018·0023 의 'YY.MM.DD' 대신 format.ts 와 같은 규칙
  if p_kind in ('SCHEDULE_CHANGED', 'ROUND_SCHEDULE_CHANGED') then
    v_os := (p_model ->> 'oldStartDate')::date;
    v_oe := (p_model ->> 'oldEndDate')::date;
    v_ns := (p_model ->> 'startDate')::date;
    v_ne := (p_model ->> 'endDate')::date;
    v_diff := case
      when v_os is null or v_oe is null then null
      when v_os is not distinct from v_ns and v_oe is distinct from v_ne then '마감 ' || public.notify_date(v_oe, v_today) || ' → ' || public.notify_date(v_ne, v_today)
      when v_oe is not distinct from v_ne and v_os is distinct from v_ns then '시작 ' || public.notify_date(v_os, v_today) || ' → ' || public.notify_date(v_ns, v_today)
      else '기간 ' || public.notify_range(v_os, v_oe, v_today) || ' → ' || public.notify_range(v_ns, v_ne, v_today)
    end;
  end if;
  v_tasks := coalesce((p_model ->> 'tasks')::int, 1);
  v_body := case
    -- 0034: 새 과제·일정·담당 건수 중 0 이 아닌 것만
    when p_kind = 'CURRICULUM_BULK_UPDATED' then
      nullif(concat_ws(' · ',
        case when coalesce((p_model ->> 'newTasks')::int, 0) > 0 then '새 과제 ' || (p_model ->> 'newTasks') || '건' end,
        case when coalesce((p_model ->> 'schedule')::int, 0) > 0 then '일정 ' || (p_model ->> 'schedule') || '건' end,
        case when coalesce((p_model ->> 'assign')::int, 0) > 0 then '담당 ' || (p_model ->> 'assign') || '건' end), '')
    when p_kind = 'MEMBER_JOINED' then
      case p_model ->> 'via' when 'invite' then '초대로 바로 참가했어요' else '추가 모집으로 참가했어요' end
      || ' · 지정 과제 담당이 필요하면 진행목표에서 정해 주세요'
    when p_kind = 'ROOM_PERIOD_CHANGED' then
      coalesce(public.notify_range((p_model ->> 'oldStartDate')::date, (p_model ->> 'oldEndDate')::date, v_today) || ' → ', '')
      || public.notify_range((p_model ->> 'startDate')::date, (p_model ->> 'endDate')::date, v_today)
    when p_kind = 'ROUND_STARTED' and v_label is not null and v_node is distinct from v_label then v_node
    -- 0028: 묶음 이동 묶음 알림(과제 2개 이상). 묶음 시작만 바꿔도 하위 과제는 종료일까지 함께 옮겨지므로
    -- 0023 의 '시작/마감만' 축약(v_diff) 대신 항상 '기간 옛 범위 → 새 범위' (리뷰 M1)
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null and p_model ? 'bundle' then
      format('"%s" 과제 %s개 일정이 %s일 %s 옮겨졌어요', v_node, v_tasks, abs((p_model ->> 'days')::int),
             case when (p_model ->> 'days')::int < 0 then '앞으로' else '뒤로' end)
      || coalesce(' · 기간 ' || public.notify_range(v_os, v_oe, v_today) || ' → ' || public.notify_range(v_ns, v_ne, v_today), '')
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null and v_diff is not null then
      format('"%s" %s', v_node, v_diff)
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null then
      format('"%s"', v_node)
      || coalesce(' ' || public.notify_range((p_model ->> 'startDate')::date, (p_model ->> 'endDate')::date, v_today), '')
    when p_kind = 'ROUND_SCHEDULE_CHANGED' and p_node is not null then
      case when v_label is not null and v_label is distinct from v_node then format('%s "%s"', v_label, v_node) else coalesce(v_label, format('"%s"', v_node)) end
      || coalesce(' ' || v_diff, '')
      -- 0026: 과제와 개인 목표를 나눠 말한다(옛 모델 'moved' 만 있으면 0024 문구)
      || case
           when p_model ? 'movedTasks' then
             case when coalesce((p_model ->> 'movedTasks')::int, 0) + coalesce((p_model ->> 'movedPersonal')::int, 0) = 0 then ''
                  else ' · ' || concat_ws('·',
                         case when (p_model ->> 'movedTasks')::int > 0 then format('과제 %s개', p_model ->> 'movedTasks') end,
                         case when (p_model ->> 'movedPersonal')::int > 0 then format('개인 목표 %s개', p_model ->> 'movedPersonal') end)
                       || '도 함께 옮겼어요' end
           when coalesce((p_model ->> 'moved')::int, 0) > 0 then format(' · 과제 %s개도 함께 옮겼어요', p_model ->> 'moved')
           else '' end
    when p_kind = 'JOIN_REQUESTED'  then nullif(p_model ->> 'message', '')
    when p_kind = 'LEAVE_REQUESTED' then nullif(p_model ->> 'reason', '')
    when p_kind = 'ROOM_ARCHIVED'   then '내 스터디의 보관함에서 다시 볼 수 있어요'
    when p_kind = 'SUBMISSION_DIGEST' and p_node is not null then
      case when v_tasks <= 1 then format('"%s"', v_node) else format('"%s" 외 과제 %s개', v_node, v_tasks - 1) end
  end;
  return jsonb_build_object('title', left(v_title, 200), 'body', left(v_body, 500));
end $$;

-- notify_link (0028 판 그대로 + CURRICULUM_BULK_UPDATED → 진행목표 탭)
create or replace function public.notify_link(p_kind text, p_room bigint, p_node bigint, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_node is not null and p_kind in ('TASK_ALL_SUBMITTED', 'SUBMISSION_DIGEST')
      then '/my-study/' || r.slug || '?task=' || p_node || '#submissions'
    when p_node is not null and p_kind in ('DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'PERSONAL_ARCHIVED')
      then '/my-study/' || r.slug || '?task=' || p_node
    -- 0028: 일정 변경 — 과제면 리프 포커스, 묶음(유형 없음)이면 진행목표 보기 상세
    when p_node is not null and p_kind = 'SCHEDULE_CHANGED'
      then '/my-study/' || r.slug || coalesce('?task=' || (select g.id from public.goal_nodes g where g.id = p_node and g.task_type is not null),
                                              '?tab=curriculum&item=' || p_node)
    when p_kind in ('CURRICULUM_EDITOR_GRANTED', 'CURRICULUM_EDITOR_REVOKED', 'ROUND_SCHEDULE_CHANGED', 'CURRICULUM_BULK_UPDATED')
      then '/my-study/' || r.slug || '?tab=curriculum'
    when r.leader_id = p_user and p_kind = 'JOIN_REQUESTED'  then '/my-study/' || r.slug || '#applications'
    when r.leader_id = p_user and p_kind = 'LEAVE_REQUESTED' then '/my-study/' || r.slug || '#leave-requests'
    when r.leader_id = p_user
      or exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = p_user and m.status = 'ACTIVE')
      then '/my-study/' || r.slug
    else '/rooms/' || r.slug end
  from public.rooms r where r.id = p_room
$$;
