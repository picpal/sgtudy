-- 0038_plan_exam.sql — 2026-10-21 진행목표 계획서(MCP)로 시험 리프 만들기. 배포 후 수정 금지.
-- create op 에 kind: "task"(기본) | "exam". exam = 리프 생성 직후 exam_put(빈 문항) — 웹 빠른 추가(종류=시험: node_create → exam_put(EMPTY_DRAFT))와
-- 같은 경로라 DRAFT · 문항 0 · reveal AFTER_SUBMIT · source MANUAL · 브리프 없음으로 웹에서 만든 것과 구별되지 않는다.
-- 규칙: 시험은 회차 아래 리프만(children·회차 자리 거부) · update 로 kind 를 바꿀 수 없다 · 시험(기존·계획서 안)을 부모로 하는 create·move 는 EXAM_NODE.
-- diff 의 create·update·move 항목에 시험이면 exam: true (미리보기 [시험] 표시). 알림 묶기의 newTasks 에서 초안 시험은 뺀다(발행 때 EXAM_PUBLISHED).
-- 재정의(최신 판 복사): plan_validate ← 0034 · plan_run ← 0034 (0035~0037 재정의 없음). 시그니처 동일 → GRANT(없음) 유지.

-- plan_validate ← 0034 판. 0038: create kind(task|exam) · 시험 부모 거부(EXAM_NODE) · update set.kind 거부
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
  v_exam    boolean;          -- 0038 이 create 가 시험인가
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
      where key not in ('op', 'ref', 'parent', 'label', 'title', 'startDate', 'endDate', 'descriptionMd', 'taskType', 'assigneeIds', 'index', 'kind')
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
        if (v_pinfo ->> 'exam')::boolean then                                 -- 0038
          v_err := v_err || public.plan_err(f.path, 'EXAM_NODE', '시험 아래에는 항목을 둘 수 없어요', 'parent'); continue;
        end if;
      elsif jsonb_typeof(o -> 'parent') = 'string' and (o ->> 'parent') ~ '^[0-9]{1,18}$' then
        select * into v_node from public.goal_nodes where id = (o ->> 'parent')::bigint and room_id = r.id;
        if not found then
          v_err := v_err || public.plan_err(f.path, 'NODE_NOT_FOUND', '항목을 찾을 수 없어요', 'parent'); continue;
        elsif v_node.task_type = 'PERSONAL' then
          v_err := v_err || public.plan_err(f.path, 'PERSONAL_NODE', '개인 목표는 진행목표 편집으로 바꿀 수 없어요', 'parent'); continue;
        elsif v_node.archived_at is not null then
          v_err := v_err || public.plan_err(f.path, 'PARENT_ARCHIVED', '보관된 항목 아래에는 추가할 수 없어요', 'parent'); continue;
        elsif exists (select 1 from public.exams x where x.node_id = v_node.id) then   -- 0038
          v_err := v_err || public.plan_err(f.path, 'EXAM_NODE', '시험 아래에는 항목을 둘 수 없어요', 'parent'); continue;
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

      -- 0038 종류: 시험은 회차 아래 리프만(웹 빠른 추가와 같은 자리)
      v_exam := false;
      if o ? 'kind' and o -> 'kind' <> 'null'::jsonb then
        if jsonb_typeof(o -> 'kind') <> 'string' or (o ->> 'kind') not in ('task', 'exam') then
          v_err := v_err || public.plan_err(f.path, 'VALIDATION_FAILED', '종류(kind)는 task 또는 exam 이에요', 'kind'); continue;
        end if;
        v_exam := (o ->> 'kind') = 'exam';
      end if;
      if v_exam and f.has_children then
        v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', '시험에는 하위 항목(children)을 둘 수 없어요', 'kind'); continue;
      end if;
      if v_exam and v_depth = 2 then
        v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', '시험은 회차 아래에 만들어요(parent 에 회차를 주세요)', 'kind'); continue;
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

      v_info := v_info || jsonb_build_object(f.path, jsonb_build_object('depth', v_depth, 's', v_s, 'e', v_e, 'exam', v_exam));
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
      if s ? 'kind' then                                                      -- 0038 종류는 만들 때만
        v_err := v_err || public.plan_err(f.path, 'PLAN_INVALID', '종류(kind)는 바꿀 수 없어요 · 시험은 create 에 kind:"exam" 으로 새로 만들어요', 'kind'); continue;
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
      if (v_info -> (v_refs ->> substr(o ->> 'parent', 2)) ->> 'exam')::boolean then   -- 0038
        v_err := v_err || public.plan_err(f.path, 'EXAM_NODE', '시험 아래로는 옮길 수 없어요', 'parent'); continue;
      end if;
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
      elsif exists (select 1 from public.exams x where x.node_id = v_node.id) then   -- 0038
        v_err := v_err || public.plan_err(f.path, 'EXAM_NODE', '시험 아래로는 옮길 수 없어요', 'parent'); continue;
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

-- plan_run ← 0034 판. 0038: create kind:"exam" → 리프 생성 직후 exam_put(빈 문항)(웹 빠른 추가와 같은 경로) · diff 에 exam:true
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
  select coalesce(max(id), 0) into v_after_id from public.notifications;      -- ⑥ 알림 묶기 기준점
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
          if o ->> 'kind' = 'exam' then                                       -- 0038 빈 초안(DRAFT·문항 0) — exam_put 이 리프·편집 관문을 다시 본다
            perform public.exam_put(v_slug, v_id, '{"questions": []}'::jsonb);
          end if;
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
                    'kind', public.plan_kind(a), 'title', a.title, 'changes', v_chg)
                    || case when exists (select 1 from public.exams x where x.node_id = v_id) then '{"exam": true}'::jsonb else '{}'::jsonb end);   -- 0038
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
                                                                then null else b.parent_id::text end, 'index', b.sort_order))
                    || case when exists (select 1 from public.exams x where x.node_id = v_id) then '{"exam": true}'::jsonb else '{}'::jsonb end);   -- 0038
          v_moved := v_moved + 1;
      end case;
    end loop;
    v_cur := null;
    -- 〔N2〕 새 값을 최종 행으로 갱신하고, 계획 안에서 원위치된 항목은 뺀다
    select coalesce(jsonb_object_agg(e.k, jsonb_build_array(e.v -> 0, e.v -> 1, g.start_date, g.end_date)), '{}'::jsonb) into v_sched
    from jsonb_each(v_sched) e(k, v) join public.goal_nodes g on g.id = e.k::bigint
    where jsonb_build_array(g.start_date, g.end_date) <> jsonb_build_array(e.v -> 0, e.v -> 1);
    perform public.assignment_resync(r.id);
    v_notes := public.plan_collapse_notifications(r.id, v_uid, v_after_id,     -- 〔§5.4〕 수신자당 ≤ 1건(dry 면 함께 되감긴다)
                 (select coalesce(array_agg(value::bigint), '{}'::bigint[]) from jsonb_each_text(v_ids)
                  where not exists (select 1 from public.exams x where x.node_id = value::bigint)));   -- 0038 초안 시험은 「새 과제」로 세지 않는다(발행 때 EXAM_PUBLISHED)
    -- create diff: 최종 상태로(리프 → 묶음 전환 반영). dry-run 이면 id null(되감긴 임시 id 비노출), 새 부모는 parentPath. 〔P4〕 지정 과제는 담당 닉네임
    for f in select * from public.plan_flatten(p_plan) x where coalesce(x.op ->> 'op', 'create') = 'create' loop
      select * into a from public.goal_nodes where id = (v_ids ->> f.path)::bigint;
      v_dm := v_dm || jsonb_build_object(f.path, jsonb_build_object('path', f.path, 'op', 'create', 'ref', f.op ->> 'ref',
        'id', case when v_dry then null else a.id::text end, 'kind', public.plan_kind(a), 'title', a.title, 'label', a.label,
        'taskType', lower(a.task_type), 'startDate', to_char(a.start_date, 'YYYY-MM-DD'), 'endDate', to_char(a.end_date, 'YYYY-MM-DD'),
        'parent', case when f.parent_path is null and left(coalesce(f.op ->> 'parent', ''), 1) <> '@' then f.op ->> 'parent' end,
        'parentPath', coalesce(f.parent_path, case when left(f.op ->> 'parent', 1) = '@' then v_refs ->> substr(f.op ->> 'parent', 2) end))
        || case when a.task_type = 'DESIGNATED' then jsonb_build_object('assignees', public.plan_nicks(a.id)) else '{}'::jsonb end
        || case when exists (select 1 from public.exams x where x.node_id = a.id) then '{"exam": true}'::jsonb else '{}'::jsonb end);   -- 0038
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
