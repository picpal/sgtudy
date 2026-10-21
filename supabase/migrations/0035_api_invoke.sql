-- 0035_api_invoke.sql — 2026-10-19 AI 연동(MCP) 1단계: anon 이 부르는 게이트웨이. 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-19-ai-integration-design.md §4.2·§6 + UX 재검토(D14·D16·D20·T4·T5).
-- PAT → api_authenticate(신원 GUC — 0033, 그 함수만 쓴다) → 기존/신규 RPC. 디스패치 오류는 JSON 으로 돌려 감사 행이 남게 한다.
-- 공개: api_invoke(anon, authenticated). 나머지(api_error_json·api_studies·api_resolve_study·api_node_file_counts·api_curriculum_view·
-- personal_create_many·personal_delete_many)는 GRANT 없음(0002 default privileges).

-- ───────── 1. 오류 → {code, message, details?} ─────────
-- P0001(public.fail) 만 코드·문구·details 를 그대로. 형식 오류는 VALIDATION_FAILED, 그 밖(SQL 원문)은 INTERNAL 로 감춘다
create or replace function public.api_error_json(p_state text, p_code text, p_detail text, p_hint text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_h jsonb;
begin
  if p_state = 'P0001' and p_code ~ '^[A-Z][A-Z0-9_]*$' then
    begin v_h := nullif(p_hint, '')::jsonb; exception when others then v_h := null; end;
    return jsonb_strip_nulls(jsonb_build_object('code', p_code, 'message', coalesce(p_detail, p_code),
             'details', case when jsonb_typeof(v_h) = 'object' and v_h <> '{}'::jsonb then v_h end));
  end if;
  if p_state in ('22P02', '22007', '22008', '22003', '22023', '42883') then
    return jsonb_build_object('code', 'VALIDATION_FAILED', 'message', '입력 형식이 올바르지 않아요');
  end if;
  return jsonb_build_object('code', 'INTERNAL', 'message', '처리 중 오류가 났어요');
end $$;

-- ───────── 2. 개인 목표 일괄 추가·삭제 ─────────
-- 〔D14〕 회차 선택자(plan_round_pick, 0034) · 〔T5〕 같은 회차·같은 제목(trim)의 내 목표는 건너뜀(재시도 멱등)
-- 〔C#2〕 순서: 방 잠금(personal_room) → 자격 → 회차 → 입력 → 중복 → 생성. 전부 중복이어도 앞 검사는 돈다
create or replace function public.personal_create_many(p_slug text, p_round jsonb, p_goals jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  g      jsonb;
  k      text;
  v_t    text;
  v_res  jsonb;
  v_ids  jsonb := '[]'::jsonb;
  v_skip jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_warn jsonb := '[]'::jsonb;
  v_uid  uuid := public.require_user();
  r      public.rooms;
  v_pick jsonb;
  v_rd   public.goal_nodes;
begin
  r := public.personal_room(p_slug, v_uid);                                   -- ① room_lock FOR UPDATE · 읽기 · RECRUIT/ACTIVE
  if not public.personal_eligible(r.id, v_uid) then                           -- ②
    perform public.fail('NOT_ACTIVE_MEMBER', '참가 중인 팀원만 개인 목표를 만들 수 있어요');
  end if;
  v_pick := public.plan_round_pick(r, coalesce(p_round, '"current"'::jsonb)); -- ③
  if v_pick ? 'error' then
    perform public.fail(v_pick #>> '{error,code}', coalesce(v_pick #>> '{error,message}', '회차를 찾을 수 없어요'),
      jsonb_strip_nulls(jsonb_build_object('candidates', v_pick #> '{error,candidates}')));
  end if;
  v_rd := public.personal_round(r.id, (v_pick ->> 'id')::bigint);            --    보관·과제형 회차 거부(0014)
  if jsonb_typeof(p_goals) is distinct from 'array' then                      -- ④
    perform public.fail('VALIDATION_FAILED', '개인 목표는 한 번에 1~20개예요', '{"field":"goals"}'::jsonb);
  end if;
  if jsonb_array_length(p_goals) not between 1 and 20 then
    perform public.fail('VALIDATION_FAILED', '개인 목표는 한 번에 1~20개예요', '{"field":"goals"}'::jsonb);
  end if;
  for g in select value from jsonb_array_elements(p_goals) loop
    if jsonb_typeof(g) <> 'object' then perform public.fail('VALIDATION_FAILED', '목표 항목이 올바르지 않아요', '{"field":"goals"}'::jsonb); end if;
    for k in select jsonb_object_keys(g) loop
      if k not in ('title', 'startDate', 'endDate', 'descriptionMd') then
        perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', left(k, 40)));
      end if;
    end loop;
  end loop;
  for g in select value from jsonb_array_elements(p_goals) loop               -- ⑤⑥ (방 잠금 안 — 동시 호출이 같은 제목을 둘 다 만들지 못한다)
    v_t := trim(coalesce(g ->> 'title', ''));
    if v_t <> '' and (v_t = any(v_seen) or exists (
          select 1 from public.goal_nodes n where n.parent_id = v_rd.id and n.owner_id = v_uid and n.task_type = 'PERSONAL'
            and n.archived_at is null and trim(n.title) = v_t)) then
      v_skip := v_skip || to_jsonb(v_t);
      continue;
    end if;
    v_seen := v_seen || v_t;
    v_res := public.personal_create(p_slug, v_rd.id, g ->> 'title', (g ->> 'startDate')::date, (g ->> 'endDate')::date, coalesce(g ->> 'descriptionMd', ''));
    v_ids := v_ids || to_jsonb(v_res ->> 'createdId');
    v_warn := v_warn || coalesce((select jsonb_agg(w || jsonb_build_object('message', public.plan_warn_text(w ->> 'code')))   -- 〔C#9〕
                                  from jsonb_array_elements(v_res -> 'warnings') w), '[]'::jsonb);
  end loop;
  return jsonb_build_object('createdIds', v_ids, 'skipped', v_skip, 'warnings', v_warn, 'count', jsonb_array_length(v_ids),
    'round', jsonb_build_object('id', v_rd.id::text, 'label', v_rd.label, 'title', v_rd.title),
    'remaining', public.personal_limit() - (select count(*) from public.goal_nodes n where n.parent_id = v_rd.id and n.owner_id = v_uid
                                              and n.task_type = 'PERSONAL' and n.archived_at is null));
end $$;

-- 〔D16〕 내 개인 목표만, 제출 있는 것은 거부(웹 personal_delete 보다 엄격), 원자
-- 〔C#1〕 방 잠금이 먼저: 제출 경로(submission_target·personal_complete)도 같은 room_lock 을 잡으므로 검사 뒤 제출이 끼지 못한다
-- 〔C#10〕 id 중복 제거 · 이 방의 내 개인 목표가 아닌 id(이미 지워짐·남의 목표·팀 노드)는 모두 skipped(재호출 멱등).
--   남의 목표를 NOT_OWNER 로 구분하지 않는다 — 존재를 드러내지 않게(0014 personal_get 의 존재 숨김과 같은 뜻)
create or replace function public.personal_delete_many(p_slug text, p_ids jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := public.require_user();
  r      public.rooms;
  v_ids  bigint[];
  v_id   bigint;
  v_del  bigint[] := '{}';
  v_skip jsonb := '[]'::jsonb;
  n      public.goal_nodes;
begin
  r := public.personal_room(p_slug, v_uid);                                   -- ① 잠금
  if jsonb_typeof(p_ids) is distinct from 'array' then
    perform public.fail('VALIDATION_FAILED', '한 번에 1~20개를 지울 수 있어요', '{"field":"ids"}'::jsonb);
  end if;
  if jsonb_array_length(p_ids) not between 1 and 20
     or exists (select 1 from jsonb_array_elements(p_ids) e where jsonb_typeof(e) not in ('string', 'number')) then
    perform public.fail('VALIDATION_FAILED', '한 번에 1~20개를 지울 수 있어요', '{"field":"ids"}'::jsonb);
  end if;
  select array_agg(x order by x) into v_ids                                   -- ② 형식 오류는 22P02 → VALIDATION_FAILED
  from (select distinct (e #>> '{}')::bigint as x from jsonb_array_elements(p_ids) e) z;
  foreach v_id in array v_ids loop                                           -- ③ 전부 검사(아무것도 지우기 전에)
    select * into n from public.goal_nodes x
    where x.id = v_id and x.room_id = r.id and x.task_type = 'PERSONAL' and x.owner_id = v_uid;
    if not found then v_skip := v_skip || to_jsonb(v_id::text); continue; end if;
    if exists (select 1 from public.submissions s where s.node_id = n.id) then
      perform public.fail('NODE_HAS_SUBMISSIONS', '완료(제출)한 목표는 AI 로 지울 수 없어요. 웹에서 지워 주세요', jsonb_build_object('nodeId', v_id::text));
    end if;
    v_del := v_del || v_id;
  end loop;
  foreach v_id in array v_del loop                                           -- ④ (personal_delete 의 room_lock 은 같은 트랜잭션 재잠금 — 즉시)
    perform public.personal_delete(p_slug, v_id);
  end loop;
  return jsonb_build_object('deleted', cardinality(v_del), 'skipped', v_skip);
end $$;

-- ───────── 3. 읽기 보조 ─────────
-- 〔C#5〕 노드마다 isMine(ownerId = 호출자, 팀 노드 false) — 포맷터가 호출자 id 없이 "내 목표" 를 고른다.
-- 남의 개인 목표 노출 규칙(curriculum_json 의 v_viewer)은 그대로
create or replace function public.api_curriculum_view(p_c jsonb, p_uid uuid) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_c -> 'nodes') = 'array' then jsonb_set(p_c, '{nodes}', coalesce((
    select jsonb_agg(e || jsonb_build_object('isMine', coalesce(e ->> 'ownerId' = p_uid::text, false)) order by o)
    from jsonb_array_elements(p_c -> 'nodes') with ordinality x(e, o)), '[]'::jsonb)) else p_c end
$$;

-- 〔C#8·D20〕 팀 노드의 붙은 READY NODE_DOC 개수 {nodeId: n}(0 은 없음). 0030 node_files_json 과 같은 조건. 집계를 중첩하지 않는다
create or replace function public.api_node_file_counts(p_room bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(c.node_id::text, c.n), '{}'::jsonb)
  from (select f.node_id, count(*)::int as n
        from public.files f join public.goal_nodes n on n.id = f.node_id
        where n.room_id = p_room and n.owner_id is null                       -- 팀 노드만
          and f.purpose = 'NODE_DOC' and f.status = 'READY' and f.attached_at is not null
        group by f.node_id) c
$$;

-- 내 스터디 평평한 목록. 범위(where)는 0032 판 me_studies 복사 — 그룹장 방(DRAFT 포함) · ACTIVE 멤버 ·
-- 대기자는 RECRUIT·DRAFT 방 또는 추가 모집 창이 열린 ACTIVE 방(0032). me_studies 는 그룹 모양이라 직접 재사용하지 않는다.
-- 항목 = me_studies 항목(slug·title·intro·membership·archived·when) + status·role·canEditCurriculum·startDate·endDate·currentRound·canAddPersonal.
-- 정렬: 진행 중 → 모집(대기 신청 포함) → 종료, 그 안은 시작일. 종료 방은 p_include_ended 일 때만. 보관 방은 없음
create or replace function public.api_studies(p_uid uuid, p_include_ended boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := public.kst_today();
  v_items jsonb;
begin
  with mine as (
    select r, m, r.id, r.start_date,
           -- me_studies(0032) 와 같은 묶음: 대기 신청은 방 상태와 무관하게 '모집'
           case when m.status = 'PENDING' and r.leader_id <> p_uid then 'recruit'
                when r.status = 'ACTIVE' then 'active' when r.status in ('RECRUIT', 'DRAFT') then 'recruit' else 'ended' end as kind,
           public.room_recruit_until(r) as recruit_end,
           public.room_current_round_id(r.id, v_today) as cur
    from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = p_uid
    where r.archived_at is null
      -- 0032 me_studies where 절 그대로
      and (r.leader_id = p_uid or m.status = 'ACTIVE'
           or (m.status = 'PENDING' and (r.status in ('RECRUIT', 'DRAFT') or public.room_recruit_open(r))))),
  due as (
    select n.room_id, min(n.end_date) as d
    from public.goal_nodes n
    join public.task_assignments a on a.node_id = n.id and a.user_id = p_uid and a.released_at is null
    left join public.submissions s on s.node_id = n.id and s.user_id = p_uid
    where n.task_type is not null and n.archived_at is null and s.id is null
      and n.start_date <= v_today and v_today <= n.end_date
    group by n.room_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'slug', (x.r).slug, 'title', (x.r).title, 'intro', (x.r).intro,
           'membership', case when (x.r).leader_id = p_uid then 'leader' when (x.m).status = 'PENDING' then 'pending' else 'joined' end,
           'archived', false,
           'when', case x.kind
             when 'active'  then jsonb_build_object('kind', case when d.d is null then 'end' else 'deadline' end,
                                                    'date', to_char(coalesce(d.d, (x.r).end_date), 'YYYY-MM-DD'))
             when 'recruit' then case when x.recruit_end is not null
                                      then jsonb_build_object('kind', 'recruitEnd', 'date', to_char(x.recruit_end, 'YYYY-MM-DD'))
                                      else jsonb_build_object('kind', 'start', 'date', to_char((x.r).start_date, 'YYYY-MM-DD')) end
             else jsonb_build_object('kind', 'end', 'date', to_char((x.r).end_date, 'YYYY-MM-DD')) end,
           'status', lower((x.r).status),
           'role', case when (x.r).leader_id = p_uid then 'leader' when (x.m).status = 'PENDING' then 'pending'
                        when public.member_can_edit_curriculum(x.r, x.m) then 'editor' else 'member' end,
           'canEditCurriculum', public.member_can_edit_curriculum(x.r, x.m),
           'startDate', to_char((x.r).start_date, 'YYYY-MM-DD'), 'endDate', to_char((x.r).end_date, 'YYYY-MM-DD'),
           'currentRound', (select jsonb_build_object('id', c.id::text, 'label', c.label, 'title', c.title,
                                     'startDate', to_char(c.start_date, 'YYYY-MM-DD'), 'endDate', to_char(c.end_date, 'YYYY-MM-DD'))
                            from public.goal_nodes c where c.id = x.cur),
           'canAddPersonal', (x.r).status in ('RECRUIT', 'ACTIVE') and public.personal_eligible(x.id, p_uid))
           order by case x.kind when 'active' then 0 when 'recruit' then 1 else 2 end, x.start_date, x.id), '[]'::jsonb)
  into v_items
  from mine x left join due d on d.room_id = x.id
  where x.kind <> 'ended' or coalesce(p_include_ended, false);
  return jsonb_build_object('today', to_char(v_today, 'YYYY-MM-DD'), 'items', v_items);
end $$;

-- 〔D14〕 study(slug 또는 제목 일부) → slug. ① slug 정확 일치 — 내 스터디가 아니어도 읽을 수 있는 방(room_readable: 공개 방 등)만.
--   못 읽는 방의 slug 는 없는 slug 와 똑같이 아래로 흘러 STUDY_NOT_FOUND(존재 숨김 — 웹 RPC 의 ROOM_NOT_FOUND 관례와 같은 뜻)
-- ② 내 스터디(api_studies 범위, 종료 제외) 제목에 대소문자 무시 부분 일치가 1개 ③ 비었으면 내 진행·모집 스터디가 1개일 때 그것.
-- 0개 STUDY_NOT_FOUND, 2개 이상 STUDY_AMBIGUOUS(details.candidates [{slug,title}] ≤10) — 추측하지 않는다
create or replace function public.api_resolve_study(p_uid uuid, p_text text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_t text := nullif(trim(coalesce(p_text, '')), ''); v_c jsonb;
begin
  if v_t is not null and exists (select 1 from public.rooms x where x.slug = v_t and public.room_readable(x.id, p_uid)) then return v_t; end if;
  select coalesce(jsonb_agg(jsonb_build_object('slug', x ->> 'slug', 'title', x ->> 'title') order by o), '[]'::jsonb) into v_c
  from jsonb_array_elements(public.api_studies(p_uid, false) -> 'items') with ordinality y(x, o)
  where (v_t is null and x ->> 'status' in ('active', 'recruit', 'draft'))
     or (v_t is not null and strpos(lower(x ->> 'title'), lower(v_t)) > 0);
  if jsonb_array_length(v_c) = 1 then return v_c -> 0 ->> 'slug'; end if;
  if jsonb_array_length(v_c) = 0 then
    perform public.fail('STUDY_NOT_FOUND', case when v_t is null then '참여 중인 스터디가 없어요. study 로 스터디를 지정해 주세요'
                                               else '그 이름의 스터디를 찾을 수 없어요' end,
      jsonb_strip_nulls(jsonb_build_object('query', left(v_t, 40))));
  end if;
  perform public.fail('STUDY_AMBIGUOUS', '여러 스터디가 맞아요. study 에 slug 로 하나를 골라 주세요',
    jsonb_build_object('candidates', (select jsonb_agg(e order by i) from jsonb_array_elements(v_c) with ordinality z(e, i) where i <= 10)));
end $$;

-- ───────── 4. 게이트웨이 ─────────
-- api_invoke(token, op, args) → {ok:true, data, meta} | {ok:false, error:{code,message,details?}, meta}. meta = {expiresAt}(PAT)
-- 예외(라우트가 HTTP 상태로): PAYLOAD_TOO_LARGE(413, 인증 전) · VALIDATION_FAILED(인자가 객체 아님) · API_AUTH_CONFLICT · AUTH_REQUIRED ·
--   API_TOKEN_INVALID/EXPIRED · API_UNKNOWN_OP · API_SCOPE_DENIED · API_RATE_LIMITED. 감사 대상 아님.
-- 신원: token 이 있으면 PAT(로그인 세션이 함께 있으면 API_AUTH_CONFLICT), 없으면 로그인 세션(auth.uid()) — source SESSION|OAUTH.
-- 잠금 순서(Global Constraints): (토큰 행 — api_authenticate) → 사용자(api_user_lock / api_rate_check) → 방(room_lock) → 초안.
--   〔C#7·N3〕 apply 는 사용자 → 초안의 방을 잠근 뒤에 replay 를 판정하고 그 다음 api_rate_check(replay 는 적용 한도 제외).
-- 실행 시간 상한: 함수 속성 statement_timeout 은 이미 시작된 문장의 타이머를 다시 걸지 않아 효과가 없다 → 두지 않는다.
--   실제 상한은 PostgREST 호출 역할의 statement_timeout(Supabase 기본 anon 3s · authenticated 8s — 로컬에서 확인, 호스티드는 배포 전 확인). PAT 경로(anon 키) = 3s.
-- 〔C#12〕 감사 보장 범위 = 업무 오류. exception when others 는 query_canceled(57014 — 역할 statement_timeout·클라이언트 취소)·
--   assert_failure 를 잡지 않는다 → 그때는 트랜잭션 전체(감사 행 포함)가 롤백된다. 의도된 범위 밖(감사 = 업무 결과 기록):
--   라우트가 TIMEOUT 을 받으면 토큰 없이 운영 로그를 남긴다(Task 8). 취소된 트랜잭션에서 더 실행하지 않으려고 query_canceled 는 잡지 않는다.
-- 감사 insert 는 레이트리밋 집계와 같은 트랜잭션(사용자 잠금 유지 중) — 커밋 뒤 다음 대기자가 이 행까지 센다. 요약에 토큰 원문은 없다.
create or replace function public.api_invoke(p_token text, p_op text, p_args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t        public.api_tokens;
  v_args   jsonb := coalesce(p_args, '{}'::jsonb);
  v_uid    uuid;
  v_source text;
  v_dry    boolean;
  v_room   bigint;
  v_data   jsonb;
  v_out    jsonb;
  v_state  text;
  v_code   text;
  v_msg    text;
  v_hint   text;
  v_ok     boolean;
  v_err    text;
  v_slug   text;
  v_replay boolean := false;
begin
  if octet_length(v_args::text) > 307200 then                                  -- 〔C#11〕 해석·인증 전에 크기부터(라우트 우회 대비)
    perform public.fail('PAYLOAD_TOO_LARGE', '요청이 너무 커요(300KB 까지). 계획을 나눠 주세요');
  end if;
  if jsonb_typeof(v_args) <> 'object' then perform public.fail('VALIDATION_FAILED', '인자가 올바르지 않아요'); end if;
  if p_token is not null then
    if auth.uid() is not null then perform public.fail('API_AUTH_CONFLICT', '토큰과 로그인 세션을 함께 쓸 수 없어요'); end if;
    t := public.api_authenticate(p_token, p_op);
    v_uid := t.user_id;
    v_source := 'PAT';
  else
    v_uid := auth.uid();
    if v_uid is null then perform public.fail('AUTH_REQUIRED', '로그인이 필요해요'); end if;
    if public.api_scope_of(p_op) is null then perform public.fail('API_UNKNOWN_OP', '지원하지 않는 작업이에요', jsonb_build_object('op', left(p_op, 40))); end if;
    v_source := case when nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id' is not null then 'OAUTH' else 'SESSION' end;
  end if;
  v_dry := case p_op when 'curriculum_plan_preview' then true when 'curriculum_plan_apply' then false end;
  if p_op = 'curriculum_plan_apply' then                                       -- 〔C#7·N3〕 소유권 확인된 재생은 적용 한도 제외
    perform public.api_user_lock(v_uid);                                       -- ① 사용자(rate check 가 다시 잡아도 즉시)
    select x.slug into v_slug from public.api_plan_drafts d join public.rooms x on x.id = d.room_id
    where d.id = v_args ->> 'previewId' and d.user_id = v_uid;
    if v_slug is not null then perform public.room_lock(v_slug); end if;       -- ② 방(웹 직접 apply 와도 직렬화)
    v_replay := exists (select 1 from public.api_plan_drafts d                 -- ③ 잠금 뒤에 읽는다
                        where d.id = v_args ->> 'previewId' and d.user_id = v_uid and d.applied_at is not null);
    v_slug := null;                                                            --    (아래 디스패치가 다시 정한다)
  end if;
  -- ④ 사용자 잠금 → 집계(그 안). whoami 는 잠금 없이 분당 한도만 — 라우트가 HTTP 요청마다 부른다(〔C#6〕)
  perform public.api_rate_check(t.id, v_uid, p_op, v_dry, v_replay);

  begin
    -- 〔D14〕 스터디 해석: study|slug → slug (apply 는 초안의 방). 해석 오류도 디스패치 오류로 감사된다
    if p_op = 'curriculum_plan_apply' then
      select x.slug, x.id into v_slug, v_room from public.api_plan_drafts d join public.rooms x on x.id = d.room_id
      where d.id = v_args ->> 'previewId' and d.user_id = v_uid;
      if v_slug is null then perform public.fail('PREVIEW_NOT_FOUND', '미리보기를 찾을 수 없어요. 다시 미리 봐 주세요'); end if;
    elsif p_op in ('curriculum_get', 'curriculum_plan_preview', 'personal_create_many', 'personal_delete_many') then
      v_slug := public.api_resolve_study(v_uid, coalesce(v_args ->> 'study', v_args ->> 'slug'));
      select id into v_room from public.rooms where slug = v_slug;
    end if;
    v_data := case p_op
      when 'whoami' then jsonb_build_object('userId', v_uid::text, 'nickname', (select nickname from public.profiles where id = v_uid),
                           'source', lower(v_source), 'tokenName', t.name,
                           'scopes', to_jsonb(coalesce(t.scopes, array['curriculum:write', 'personal:write', 'read'])),
                           'expiresAt', public.iso(t.expires_at))
      when 'me_studies' then public.api_studies(v_uid, coalesce((v_args ->> 'includeEnded')::boolean, false))
      when 'me_schedule' then public.me_schedule((v_args ->> 'from')::date, (v_args ->> 'to')::date)
      when 'curriculum_get' then public.api_curriculum_view(public.curriculum_get(v_slug, coalesce((v_args ->> 'includeArchived')::boolean, false)), v_uid)
        || jsonb_build_object('version', public.curriculum_version(v_room),
             'viewer', jsonb_build_object('nickname', (select nickname from public.profiles where id = v_uid)),
             'currentRoundId', public.room_current_round_id(v_room, public.kst_today())::text,
             'fileCounts', coalesce(public.api_node_file_counts(v_room), '{}'::jsonb),
             'study', (select jsonb_build_object('slug', x.slug, 'title', x.title, 'status', lower(x.status),
                      'startDate', to_char(x.start_date, 'YYYY-MM-DD'), 'endDate', to_char(x.end_date, 'YYYY-MM-DD'))
             from public.rooms x where x.id = v_room))
      when 'curriculum_plan_preview' then public.curriculum_plan_preview(v_slug, v_args -> 'plan', v_args ->> 'undo')
      when 'curriculum_plan_apply' then public.curriculum_plan_apply(v_slug, v_args ->> 'previewId')
      when 'personal_create_many' then public.personal_create_many(v_slug, v_args -> 'round', v_args -> 'goals')
      when 'personal_delete_many' then public.personal_delete_many(v_slug, v_args -> 'ids')
    end;
    v_out := jsonb_build_object('ok', true, 'data', v_data);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_code = message_text, v_msg = pg_exception_detail, v_hint = pg_exception_hint;
    v_data := null;
    v_out := jsonb_build_object('ok', false, 'error', public.api_error_json(v_state, v_code, v_msg, v_hint));
  end;
  v_out := v_out || jsonb_build_object('meta', jsonb_strip_nulls(jsonb_build_object('expiresAt', public.iso(t.expires_at))));   -- 〔T4〕

  if p_op <> 'whoami' then
    v_ok := (v_out ->> 'ok')::boolean and coalesce((v_data ->> 'ok')::boolean, true);
    v_err := coalesce(v_out #>> '{error,code}', v_data #>> '{errors,0,code}');
    insert into public.api_audit (token_id, user_id, source, op, room_id, dry_run, ok, error_code, preview_id, summary, created_at)
    values (t.id, v_uid, v_source, p_op, v_room, v_dry, v_ok, case when not v_ok then left(v_err, 40) end,
            case when p_op like 'curriculum_plan_%' then (select x from (select coalesce(v_data ->> 'previewId', v_args ->> 'previewId') as x) z
                                                           where x ~ '^pv_[0-9a-f]{12}$') end,   -- 입력 그대로 싣지 않는다(형식 맞는 것만)
            case when p_op like 'curriculum_plan_%' then jsonb_strip_nulls(jsonb_build_object('summary', v_data -> 'summary', 'createdIds', v_data -> 'createdIds',   -- refs(사용자 라벨) 대신 id
                                                           'replayed', v_data -> 'replayed', 'undoOf', v_data -> 'undoOf'))
                 when p_op = 'personal_create_many' then jsonb_strip_nulls(jsonb_build_object('createdIds', v_data -> 'createdIds'))
                 when p_op = 'personal_delete_many' then jsonb_strip_nulls(jsonb_build_object(   -- 사용자 입력은 숫자 id 모양만(제목·자유 문자열 없음)
                   'ids', (select jsonb_agg(e) from jsonb_array_elements(case when jsonb_typeof(v_args -> 'ids') = 'array' then v_args -> 'ids' end) e
                           where e #>> '{}' ~ '^[0-9]{1,19}$'),
                   'deleted', v_data -> 'deleted'))
                 else '{}'::jsonb end,
            public.app_now());
  end if;
  return v_out;
end $$;

grant execute on function public.api_invoke(text, text, jsonb) to anon, authenticated;
