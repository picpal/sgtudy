-- 0013_backlog_fixes.sql — plan 05 QA·plan 04 인계 백로그 (백엔드). 배포 후 수정 금지.
-- 1. 자동 태그: node_update 는 제목이 실제로 바뀌고 옛/새 제목이 CURATED 용어를 담을 때만 tag_autoselect (Q3-22)
-- 2. slug: 한글 음절을 로마자(국어의 로마자 표기법, 음운 변화 없이 음절 단위)로 바꿔 slug 에 남긴다. 기존 방 slug 는 그대로 (Q2-29)
-- 3. 방 기간 상한 1년(시작일 + 1년 - 1일까지) — room_create / room_update, PERIOD_TOO_LONG (Q2-29)
-- 4. 알림 본문이 방 제목을 되풀이하지 않는다 + 기존 행 백필 (Q1-14)
-- 5. deactivate 로 전원 제출이 된 과제의 TASK_ALL_SUBMITTED, 수동 시작 방의 진행 중 회차 ROUND_STARTED,
--    ASCII 3자 이상 태그 용어는 뒤쪽 단어 경계 필요(java ⊄ JavaScript)
-- 재정의 함수는 모두 각 함수의 최신 정의(0004·0005·0006·0008·0009·0012)를 복사해 고친 것이다. 시그니처 동일 → GRANT 유지.

-- ───────── 5c. 태그 용어 일치 (0009 tag_term_hit 교체) ─────────
-- 2자 영숫자: 앞뒤 경계(기존). 3자 이상 ASCII: 뒤쪽 경계만 — 'java' ⊄ 'javascript', 'react' ⊄ 'reactive' 는 막고
-- 'sql' ⊂ 'mysql'·'postgresql' 같은 앞쪽 결합은 허용. 한글·혼합 용어는 조사 때문에 부분 일치(기존)
create or replace function public.tag_term_hit(p_text text, p_term text) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_text is null or length(trim(coalesce(p_term, ''))) < 2 then false
    when length(trim(p_term)) = 2 and trim(p_term) ~ '^[A-Za-z0-9]+$'
      then lower(p_text) ~ ('(^|[^a-z0-9])' || lower(trim(p_term)) || '($|[^a-z0-9])')
    when trim(p_term) ~ '^[ -~]+$'
      then lower(p_text) ~ (regexp_replace(lower(trim(p_term)), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '($|[^a-z0-9])')
    else position(lower(trim(p_term)) in lower(p_text)) > 0
  end
$$;

-- 글이 CURATED 태그 용어(라벨·별칭) 하나라도 담는지 — node_update 의 자동 선택 가드
create or replace function public.tag_text_relevant(p_text text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_text, '') <> '' and exists (
    select 1 from public.tags t cross join lateral unnest(array_append(t.aliases, t.label)) as x(term)
    where t.kind = 'CURATED' and public.tag_term_hit(p_text, x.term))
$$;

-- ───────── 2. slug (0002 slugify 교체) ─────────
-- 한글 음절 → 로마자(초성 19·중성 21·종성 28 표, 음절 단위). 그 밖의 비 ASCII(이모지 등)는 구분자. 결과가 비면 r-<base36 id>(기존)
create or replace function public.slugify(p_title text, p_id bigint)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := '';
  c text;
  cp int;
  s int;
  v_n bigint := p_id;
  v_b36 text := '';
  v_digits constant text := '0123456789abcdefghijklmnopqrstuvwxyz';
  v_ini constant text[] := array['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
  v_med constant text[] := array['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
  v_fin constant text[] := array['','k','k','k','n','n','n','t','l','k','m','l','l','l','p','l','m','p','p','t','t','ng','t','t','k','t','p','t'];
begin
  foreach c in array regexp_split_to_array(coalesce(p_title, ''), '') loop
    cp := ascii(c);
    if cp between 44032 and 55203 then          -- 가..힣
      s := cp - 44032;
      v := v || v_ini[s / 588 + 1] || v_med[(s % 588) / 28 + 1] || v_fin[s % 28 + 1];
    else
      v := v || c;
    end if;
  end loop;
  v := lower(v);
  v := regexp_replace(v, '[^a-z0-9]+', '-', 'g');
  v := trim(both '-' from v);
  if v = '' then
    if v_n = 0 then v_b36 := '0'; end if;
    while v_n > 0 loop
      v_b36 := substr(v_digits, (v_n % 36)::int + 1, 1) || v_b36;
      v_n := v_n / 36;
    end loop;
    return 'r-' || v_b36;
  end if;
  return trim(both '-' from left(v, 50));
end $$;

-- ───────── 3. 방 기간 상한 ─────────
-- 시작일 포함 최대 1년: 2026-11-01 → 2027-10-31 까지. 호출 전 start ≤ end 는 이미 검사돼 있다
create or replace function public.room_period_check(p_start date, p_end date) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_end > (p_start + interval '1 year')::date - 1 then
    perform public.fail('PERIOD_TOO_LONG', '기간은 최대 1년이에요',
                        jsonb_build_object('field', 'endDate', 'maxEndDate', to_char((p_start + interval '1 year')::date - 1, 'YYYY-MM-DD')));
  end if;
end $$;

-- (0006 node_update)
create or replace function public.node_update(p_slug text, p_node_id bigint, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r         public.rooms;
  n         public.goal_nodes;
  p         public.goal_nodes;
  v_uid     uuid;
  k         text;
  v_title   text;
  v_desc    text;
  v_s       date;
  v_e       date;
  v_label   text;
  v_type    text;
  v_ids     uuid[];          -- null = 담당자 변경 없음
  v_cur     uuid[];
  v_added   uuid[] := '{}';
  v_removed uuid[] := '{}';
  v_bad     uuid;
  v_asg     int;
  v_rcpt    uuid[];
  v_warn    jsonb := '[]'::jsonb;
begin
  r := public.node_assert_editable(p_slug);
  v_uid := public.current_user_id();
  n := public.node_get(r.id, p_node_id);
  if n.archived_at is not null then   -- I1: 보관된 노드는 변경 전에 거부 (배정·알림 오염 방지)
    if n.task_type is null then perform public.fail('PARENT_ARCHIVED', '보관된 항목은 수정할 수 없어요', jsonb_build_object('nodeId', n.id::text)); end if;
    perform public.fail('TASK_ARCHIVED', '보관된 과제는 수정할 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform public.fail('VALIDATION_FAILED', '수정 내용이 올바르지 않아요');
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('title', 'descriptionMd', 'startDate', 'endDate', 'label', 'taskType', 'assigneeIds') then
      perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
  end loop;

  -- 제목·설명·기간·라벨 (M3: 문자열이 아니면 거부. description_md 는 NOT NULL 이라 null 로 지울 수 없다)
  for k in select unnest(array['title', 'descriptionMd', 'label']) loop
    if p_patch ? k and jsonb_typeof(p_patch->k) <> 'string' then
      perform public.fail('VALIDATION_FAILED', '문자열이어야 해요', jsonb_build_object('field', k));
    end if;
  end loop;
  v_title := case when p_patch ? 'title' then trim(coalesce(p_patch->>'title', '')) else n.title end;
  if v_title is null or length(v_title) < 1 or length(v_title) > 80 then
    perform public.fail('INVALID_TITLE', '제목은 1~80자예요', '{"field":"title"}'::jsonb);
  end if;
  v_desc := coalesce(p_patch->>'descriptionMd', n.description_md);
  if length(v_desc) > 20000 then
    perform public.fail('VALIDATION_FAILED', '설명은 20,000자까지예요', '{"field":"descriptionMd"}'::jsonb);
  end if;
  v_s := coalesce(public.patch_date(p_patch, 'startDate'), n.start_date);   -- 형식 오류 → VALIDATION_FAILED (D11)
  v_e := coalesce(public.patch_date(p_patch, 'endDate'), n.end_date);
  if v_s > v_e then perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb); end if;
  v_label := n.label;
  if p_patch ? 'label' then
    if n.depth <> 2 then perform public.fail('VALIDATION_FAILED', '회차 라벨은 회차에만 줄 수 있어요', '{"field":"label"}'::jsonb); end if;
    v_label := nullif(trim(coalesce(p_patch->>'label', '')), '');
    if v_label is null then perform public.fail('VALIDATION_FAILED', '회차 라벨은 비울 수 없어요', '{"field":"label"}'::jsonb); end if;   -- A7
    if length(v_label) > 20 then perform public.fail('VALIDATION_FAILED', '회차 라벨은 20자까지예요', '{"field":"label"}'::jsonb); end if;
  end if;

  -- 담당자는 리프에만 (E3: 결과 타입과 무관하게 비리프면 조용히 무시하지 않는다)
  if p_patch ? 'assigneeIds' and n.task_type is null then
    perform public.fail('NODE_NOT_LEAF', '하위 항목이 있는 노드에는 담당자를 줄 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;

  -- 과제 유형 (리프만, 제출물 있으면 양방향 불가)
  v_type := n.task_type;
  if p_patch ? 'taskType' then
    if n.task_type is null then perform public.fail('NODE_NOT_LEAF', '하위 항목이 있는 노드에는 과제 유형을 줄 수 없어요', jsonb_build_object('nodeId', n.id::text)); end if;
    v_type := upper(coalesce(p_patch->>'taskType', ''));
    if v_type not in ('COMMON', 'DESIGNATED') then
      perform public.fail('VALIDATION_FAILED', '과제 유형은 common 또는 designated 예요', '{"field":"taskType"}'::jsonb);
    end if;
    if v_type <> n.task_type and public.node_has_submissions(n.id) then
      perform public.fail('NODE_HAS_SUBMISSIONS', '제출물이 있는 과제는 유형을 바꿀 수 없어요', jsonb_build_object('nodeId', n.id::text));
    end if;
  end if;

  -- 담당자 (결과 타입이 DESIGNATED 일 때만)
  if v_type = 'DESIGNATED' and p_patch ? 'assigneeIds' then
    if jsonb_typeof(p_patch->'assigneeIds') <> 'array' then
      perform public.fail('VALIDATION_FAILED', '담당자 목록이 올바르지 않아요', '{"field":"assigneeIds"}'::jsonb);
    end if;
    if exists (select 1 from jsonb_array_elements(p_patch->'assigneeIds') e where jsonb_typeof(e) <> 'string') then   -- I2
      perform public.fail('VALIDATION_FAILED', '담당자 id 가 올바르지 않아요', '{"field":"assigneeIds"}'::jsonb);
    end if;
    begin
      select coalesce(array_agg(distinct x::uuid), '{}') into v_ids from jsonb_array_elements_text(p_patch->'assigneeIds') x;
    exception when invalid_text_representation then
      perform public.fail('VALIDATION_FAILED', '담당자 id 가 올바르지 않아요', '{"field":"assigneeIds"}'::jsonb);
    end;
    select u into v_bad from unnest(v_ids) u
    where not exists (select 1 from public.room_members m
                      where m.room_id = r.id and m.user_id = u and m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks))
    limit 1;
    if v_bad is not null then
      perform public.fail('ASSIGNEE_NOT_MEMBER', '활성 참가자만 담당자로 지정할 수 있어요', jsonb_build_object('field', 'assigneeIds', 'userId', v_bad::text));
    end if;
  elsif v_type = 'DESIGNATED' and n.task_type = 'COMMON' then
    -- 공통 → 지정 전환, 담당자 미지정: 전환 직전 담당자 승계 (E6)
    select coalesce(array_agg(user_id), '{}') into v_ids from public.task_assignments where node_id = n.id and released_at is null;
  end if;

  if v_ids is not null then
    select coalesce(array_agg(user_id), '{}') into v_cur from public.task_assignments where node_id = n.id and released_at is null;
    select coalesce(array_agg(u), '{}') into v_removed from unnest(v_cur) u where u <> all(v_ids);
    select coalesce(array_agg(u), '{}') into v_added   from unnest(v_ids) u where u <> all(v_cur);
    select s.user_id into v_bad from public.submissions s where s.node_id = n.id and s.user_id = any(v_removed) limit 1;
    if v_bad is not null then
      perform public.fail('ASSIGNEE_HAS_SUBMISSION', '이미 제출한 담당자는 뺄 수 없어요. 과제를 보관해 주세요', jsonb_build_object('field', 'assigneeIds', 'userId', v_bad::text));
    end if;
    update public.task_assignments set released_at = now()
    where node_id = n.id and released_at is null and user_id = any(v_removed);
    insert into public.task_assignments (node_id, user_id, source)
    select n.id, u, 'DESIGNATED' from unnest(v_ids) u
    on conflict (node_id, user_id) do update set released_at = null, source = 'DESIGNATED';
  end if;

  -- 지정 → 공통: 공통 대상이 아닌 사람의 DESIGNATED 행을 풀어 둔다. resync 가 대상자만 COMMON 으로 되살린다 (E4)
  if n.task_type = 'DESIGNATED' and v_type = 'COMMON' then
    update public.task_assignments set released_at = now()
    where node_id = n.id and source = 'DESIGNATED' and released_at is null;
  end if;

  update public.goal_nodes set
    title = v_title, description_md = v_desc, start_date = v_s, end_date = v_e, label = v_label,
    task_type = v_type, updated_at = now()
  where id = n.id;
  perform public.assignment_resync(r.id);

  -- 경고 (D9: 부모·방 기간 밖 허용 + 경고, 담당자 0명 경고)
  if n.parent_id is not null then
    select * into p from public.goal_nodes where id = n.parent_id;
    if v_s < p.start_date or v_e > p.end_date then
      v_warn := v_warn || jsonb_build_object('code', 'PERIOD_OUTSIDE_PARENT', 'nodeId', n.id::text);
    end if;
  end if;
  if v_s < r.start_date or v_e > r.end_date then
    v_warn := v_warn || jsonb_build_object('code', 'PERIOD_OUTSIDE_ROOM', 'nodeId', n.id::text);
  end if;
  if v_type = 'DESIGNATED' then
    select asg into v_asg from public.room_progress(r.id) where node_id = n.id;
    if coalesce(v_asg, 0) = 0 then v_warn := v_warn || jsonb_build_object('code', 'UNASSIGNED_TASK', 'nodeId', n.id::text); end if;
  end if;

  -- 알림 (진행중 방만. 0008 전에는 자리표가 0 을 돌려준다)
  -- 행위자(v_uid) 제외는 notify_publish 계약이 맡는다 — 여기서는 담당자 전원을 넘긴다(A5).
  -- 세 알림 모두 행위 이벤트 → prefix 'KIND:room:node:' || txid_current() (D8: 같은 사람 해제 후 재배정도 새 알림, 한 저장 안에서는 1건)
  if r.status = 'ACTIVE' and v_type is not null then
    if (v_s, v_e) is distinct from (n.start_date, n.end_date) then
      select coalesce(array_agg(user_id), '{}') into v_rcpt
      from public.task_assignments where node_id = n.id and released_at is null;
      if cardinality(v_rcpt) > 0 then
        perform public.notify_publish('SCHEDULE_CHANGED', r.id, n.id, v_uid, v_rcpt,
          'SCHEDULE_CHANGED:' || r.id || ':' || n.id || ':' || txid_current(),
          jsonb_build_object('title', v_title, 'startDate', to_char(v_s, 'YYYY-MM-DD'), 'endDate', to_char(v_e, 'YYYY-MM-DD')));
      end if;
    end if;
    if cardinality(v_added) > 0 then
      perform public.notify_publish('TASK_ASSIGNED', r.id, n.id, v_uid, v_added,
        'TASK_ASSIGNED:' || r.id || ':' || n.id || ':' || txid_current(),
        jsonb_build_object('title', v_title, 'endDate', to_char(v_e, 'YYYY-MM-DD')));
    end if;
    if cardinality(v_removed) > 0 then
      perform public.notify_publish('TASK_UNASSIGNED', r.id, n.id, v_uid, v_removed,
        'TASK_UNASSIGNED:' || r.id || ':' || n.id || ':' || txid_current(),
        jsonb_build_object('title', v_title));
    end if;
  end if;

  -- 태그 자동 선택 (0013): 노드 제목이 실제로 바뀌었고, 옛 제목이나 새 제목이 CURATED 용어를 담을 때만.
  -- 점수에 쓰이는 건 노드 제목뿐(설명은 안 쓴다)이라 용어 없는 제목끼리의 변경은 결과를 바꿀 수 없다 — 무관한 저장이
  -- 시드·수동 정리와 어긋난 AUTO 태그를 다시 뒤섞지 않게 한다(QA Q3-22). MANUAL·억제 규칙은 tag_apply_auto 가 그대로 지킨다
  if p_patch ? 'title' and v_title is distinct from n.title
     and (public.tag_text_relevant(n.title) or public.tag_text_relevant(v_title)) then
    perform public.tag_autoselect(r.id);
  end if;

  return public.curriculum_json(r.id, v_uid, true) || jsonb_build_object('warnings', v_warn);
end $$;


-- (0004 room_create)
create or replace function public.room_create(
  p_title text, p_intro text, p_start_date date, p_end_date date, p_max_members int,
  p_is_public boolean, p_join_mode text,
  p_description_md text default '', p_rules_md text default '', p_min_members int default null,
  p_leader_does_tasks boolean default true, p_cover_file_id uuid default null, p_tag_slugs text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  v_today  date := public.kst_today();
  v_title  text := trim(coalesce(p_title, ''));
  v_intro  text := trim(coalesce(p_intro, ''));
  v_id     bigint;
  v_base   text;
  v_slug   text;
  v_n      int := 2;
begin
  if length(v_title) < 1 or length(v_title) > 60 then
    perform public.fail('INVALID_TITLE', '제목은 1~60자예요', '{"field":"title"}'::jsonb);
  end if;
  if length(v_intro) < 1 or length(v_intro) > 100 then
    perform public.fail('VALIDATION_FAILED', '한 줄 소개는 1~100자예요', '{"field":"intro"}'::jsonb);
  end if;
  if p_start_date is null or p_end_date is null or p_start_date > p_end_date then
    perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb);
  end if;
  if p_start_date < v_today then
    perform public.fail('INVALID_PERIOD', '시작일은 오늘 이후여야 해요', '{"field":"startDate"}'::jsonb);
  end if;
  perform public.room_period_check(p_start_date, p_end_date);
  if p_max_members is null or p_max_members < 2 or p_max_members > 100 then
    perform public.fail('VALIDATION_FAILED', '정원은 2~100명이에요', '{"field":"maxMembers"}'::jsonb);
  end if;
  if p_min_members is not null and (p_min_members < 1 or p_min_members > p_max_members) then
    perform public.fail('VALIDATION_FAILED', '최소 인원은 1~정원 사이예요', '{"field":"minMembers"}'::jsonb);
  end if;
  if coalesce(p_join_mode, '') not in ('direct', 'approval') then
    perform public.fail('VALIDATION_FAILED', '참가 방식은 direct 또는 approval 이에요', '{"field":"joinMode"}'::jsonb);
  end if;
  if p_is_public is null then
    perform public.fail('VALIDATION_FAILED', '공개 여부를 정해 주세요', '{"field":"isPublic"}'::jsonb);
  end if;
  -- 커버는 내가 올린 COVER 용 파일만 (A8)
  if p_cover_file_id is not null and not exists (
       select 1 from public.files f where f.id = p_cover_file_id and f.owner_user_id = v_uid and f.purpose = 'COVER') then
    perform public.fail('VALIDATION_FAILED', '커버 이미지를 찾을 수 없어요', '{"field":"coverFileId"}'::jsonb);
  end if;
  if coalesce(cardinality(p_tag_slugs), 0) > 8 then
    perform public.fail('TAG_LIMIT_EXCEEDED', '태그는 8개까지예요', '{"field":"tagSlugs"}'::jsonb);
  end if;

  -- slug 는 id 가 필요하므로 임시값으로 넣고 바로 갱신
  insert into public.rooms (slug, title, intro, description_md, rules_md, start_date, end_date, max_members, min_members,
                            visibility, join_mode, leader_id, leader_does_tasks, cover_file_id, status, member_count)
  values ('tmp-' || replace(gen_random_uuid()::text, '-', ''), v_title, v_intro, coalesce(p_description_md, ''), coalesce(p_rules_md, ''),
          p_start_date, p_end_date, p_max_members, p_min_members,
          case when p_is_public then 'PUBLIC' else 'PRIVATE' end, upper(p_join_mode), v_uid, coalesce(p_leader_does_tasks, true),
          p_cover_file_id, 'DRAFT', 1)
  returning id into v_id;

  v_base := public.slugify(v_title, v_id);
  v_slug := v_base;
  -- 'new' 는 /rooms/new 라우트와 겹친다(0013)
  while v_slug = 'new' or exists (select 1 from public.rooms where slug = v_slug) loop
    v_slug := v_base || '-' || v_n;
    v_n := v_n + 1;
  end loop;
  update public.rooms set slug = v_slug where id = v_id;

  insert into public.room_members (room_id, user_id, role, status, joined_at)
  values (v_id, v_uid, 'LEADER', 'ACTIVE', now());
  insert into public.room_notification_settings (room_id) values (v_id);
  perform public.invite_ensure(v_id, v_uid);

  insert into public.room_tags (room_id, tag_slug, source, sort_order)
  select v_id, t.slug, 'MANUAL', (row_number() over (order by s.ord) - 1)::int
  from (select u.slug, min(u.ord) as ord from unnest(p_tag_slugs) with ordinality as u(slug, ord) group by u.slug) s   -- 중복 slug 는 첫 등장만(23505 방지)
  join public.tags t on t.slug = s.slug;

  return public.room_detail_json(v_id, v_uid);
end $$;


-- (0004 room_update)
create or replace function public.room_update(p_slug text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  v_today  date := public.kst_today();
  r        public.rooms;
  v_phase  text;                 -- recruit(DRAFT·RECRUIT) | active | ended
  v_locked text[];
  k        text;
  v_title  text;
  v_intro  text;
  v_start  date;
  v_end    date;
  v_max    int;
  v_min    int;
  v_ldt    boolean;
  v_pub    boolean;
  v_node_max_end date;
  v_warn   jsonb := '[]'::jsonb;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);
  if r.archived_at is not null then perform public.fail('ROOM_NOT_EDITABLE', '보관된 방은 수정할 수 없어요'); end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    perform public.fail('VALIDATION_FAILED', '수정 내용이 올바르지 않아요');
  end if;

  v_phase := case when r.status in ('DRAFT', 'RECRUIT') then 'recruit' when r.status = 'ACTIVE' then 'active' else 'ended' end;
  v_locked := case v_phase
    when 'recruit' then array['slug']
    when 'active'  then array['slug', 'startDate', 'minMembers', 'isPublic', 'joinMode', 'leaderDoesTasks']
    else array['slug', 'title', 'intro', 'descriptionMd', 'rulesMd', 'coverFileId', 'startDate', 'endDate',
               'maxMembers', 'minMembers', 'isPublic', 'joinMode', 'leaderDoesTasks'] end;

  for k in select jsonb_object_keys(p_patch) loop
    if k = any(v_locked) then
      perform public.fail('FIELD_LOCKED', '지금 상태에서는 바꿀 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
    if k not in ('title', 'intro', 'descriptionMd', 'rulesMd', 'coverFileId', 'startDate', 'endDate',
                 'maxMembers', 'minMembers', 'isPublic', 'joinMode', 'leaderDoesTasks') then
      perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
  end loop;

  v_title := case when p_patch ? 'title' then trim(coalesce(p_patch->>'title', '')) else r.title end;
  v_intro := case when p_patch ? 'intro' then trim(coalesce(p_patch->>'intro', '')) else r.intro end;
  v_start := coalesce(public.patch_date(p_patch, 'startDate'), r.start_date);
  v_end   := coalesce(public.patch_date(p_patch, 'endDate'), r.end_date);
  v_max   := coalesce(public.patch_int(p_patch, 'maxMembers'), r.max_members);
  v_min   := case when p_patch ? 'minMembers' then public.patch_int(p_patch, 'minMembers') else r.min_members end;
  v_ldt   := coalesce(public.patch_bool(p_patch, 'leaderDoesTasks'), r.leader_does_tasks);
  v_pub   := coalesce(public.patch_bool(p_patch, 'isPublic'), r.visibility = 'PUBLIC');

  if length(v_title) < 1 or length(v_title) > 60 then
    perform public.fail('INVALID_TITLE', '제목은 1~60자예요', '{"field":"title"}'::jsonb);
  end if;
  if length(v_intro) < 1 or length(v_intro) > 100 then
    perform public.fail('VALIDATION_FAILED', '한 줄 소개는 1~100자예요', '{"field":"intro"}'::jsonb);
  end if;
  if p_patch ? 'startDate' and v_start < v_today then
    perform public.fail('INVALID_PERIOD', '시작일은 오늘 이후여야 해요', '{"field":"startDate"}'::jsonb);
  end if;
  if v_start > v_end then
    perform public.fail('INVALID_PERIOD', '종료일은 시작일 이후여야 해요', '{"field":"endDate"}'::jsonb);
  end if;
  -- 기간 상한(0013): 기간을 고칠 때만 본다 — 0013 이전에 만든 긴 방은 다른 항목을 고칠 수 있어야 한다
  if p_patch ? 'startDate' or p_patch ? 'endDate' then
    perform public.room_period_check(v_start, v_end);
  end if;
  if v_phase = 'active' and p_patch ? 'endDate' then
    select max(n.end_date) into v_node_max_end from public.goal_nodes n where n.room_id = r.id and n.archived_at is null;
    if v_end < v_today or (v_node_max_end is not null and v_end < v_node_max_end) then
      perform public.fail('INVALID_PERIOD', '진행중에는 종료일을 오늘과 마지막 과제 마감 이후로만 바꿀 수 있어요', '{"field":"endDate"}'::jsonb);
    end if;
  end if;
  if v_max < 2 or v_max > 100 then
    perform public.fail('VALIDATION_FAILED', '정원은 2~100명이에요', '{"field":"maxMembers"}'::jsonb);
  end if;
  if v_max < r.member_count then
    perform public.fail('CAPACITY_BELOW_CURRENT', '현재 참가자 수보다 적게 줄일 수 없어요', jsonb_build_object('field', 'maxMembers', 'memberCount', r.member_count));
  end if;
  if v_min is not null and (v_min < 1 or v_min > v_max) then
    perform public.fail('VALIDATION_FAILED', '최소 인원은 1~정원 사이예요', '{"field":"minMembers"}'::jsonb);
  end if;
  if p_patch ? 'joinMode' and coalesce(p_patch->>'joinMode', '') not in ('direct', 'approval') then
    perform public.fail('VALIDATION_FAILED', '참가 방식은 direct 또는 approval 이에요', '{"field":"joinMode"}'::jsonb);
  end if;
  -- 커버는 내가 올린 COVER 용 파일만 (A8). 텍스트로 비교해 uuid 캐스트 오류(22P02)를 피한다. null 은 커버 제거
  if p_patch ? 'coverFileId' and jsonb_typeof(p_patch->'coverFileId') <> 'null' and not exists (
       select 1 from public.files f
       where f.id::text = p_patch->>'coverFileId' and f.owner_user_id = v_uid and f.purpose = 'COVER') then
    perform public.fail('VALIDATION_FAILED', '커버 이미지를 찾을 수 없어요', '{"field":"coverFileId"}'::jsonb);
  end if;

  update public.rooms set
    title = v_title, intro = v_intro,
    description_md = coalesce(p_patch->>'descriptionMd', description_md),
    rules_md       = coalesce(p_patch->>'rulesMd', rules_md),
    cover_file_id  = case when p_patch ? 'coverFileId' then (p_patch->>'coverFileId')::uuid else cover_file_id end,
    start_date = v_start, end_date = v_end, max_members = v_max, min_members = v_min,
    visibility = case when v_pub then 'PUBLIC' else 'PRIVATE' end,
    join_mode  = case when p_patch ? 'joinMode' then upper(p_patch->>'joinMode') else join_mode end,
    leader_does_tasks = v_ldt, updated_at = now()
  where id = r.id;

  if v_ldt <> r.leader_does_tasks then perform public.assignment_resync(r.id); end if;

  -- 방 기간 밖으로 나간 노드(보관 제외)는 경고 (D9)
  if p_patch ? 'startDate' or p_patch ? 'endDate' then
    select coalesce(jsonb_agg(jsonb_build_object('code', 'PERIOD_OUTSIDE_ROOM', 'nodeId', n.id::text) order by n.id), '[]'::jsonb)
    into v_warn
    from public.goal_nodes n
    where n.room_id = r.id and n.archived_at is null and (n.start_date < v_start or n.end_date > v_end);
  end if;

  return public.room_detail_json(r.id, v_uid) || jsonb_build_object('warnings', v_warn);
end $$;


-- ───────── 4. 알림 본문 (0012 notify_render) ─────────
create or replace function public.notify_render(p_kind text, p_room bigint, p_node bigint, p_actor uuid, p_model jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_room  text;
  v_node  text;
  v_label text;
  v_actor text;
  v_title text;
  v_body  text;
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
  end;
  -- 본문(0013): 방 제목은 프론트가 메타 줄에 따로 그리므로 본문에 넣지 않는다(QA Q1-14). 제목에 없는 정보만 —
  -- 회차 시작은 회차 제목(라벨과 다를 때), 일정 변경은 과제와 새 기간. 나머지 과제 알림은 제목이 이미 과제를 말한다
  v_body := case
    when p_kind = 'ROUND_STARTED' and v_label is not null and v_node is distinct from v_label then v_node
    when p_kind = 'SCHEDULE_CHANGED' and p_node is not null then
      format('"%s"', v_node)
      || coalesce(' ' || to_char((p_model ->> 'startDate')::date, 'MM.DD') || ' – ' || to_char((p_model ->> 'endDate')::date, 'MM.DD'), '')
  end;
  return jsonb_build_object('title', left(v_title, 200), 'body', left(v_body, 500));
end $$;


-- ───────── 5a. (0008 member_deactivate) ─────────
create or replace function public.member_deactivate(p_slug text, p_user uuid, p_decisions jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := public.require_user();
  r        public.rooms;
  p        record;
  d        jsonb;
  v_action text;
  v_new    uuid[];
  v_adds   uuid[];
  v_id     uuid;
  v_bad    boolean;
  v_plan   jsonb := '[]'::jsonb;    -- [{nodeId, adds: uuid[]}]
  v_item   jsonb;
  v_open   bigint[];               -- 0013: 이탈 전 아직 전원 제출이 아닌 과제
  v_node   bigint;
begin
  r := public.deactivate_check(p_slug, p_user, true);
  if jsonb_typeof(coalesce(p_decisions, '[]'::jsonb)) <> 'array' then
    perform public.fail('VALIDATION_FAILED', 'decisions 는 배열이어야 해요', '{"field":"decisions"}'::jsonb);
  end if;

  -- 1. 검증
  for p in select * from public.deactivate_pending(r.id, p_user) loop
    d := null;
    select e into d from jsonb_array_elements(coalesce(p_decisions, '[]'::jsonb)) e where e ->> 'nodeId' = p.node_id::text limit 1;
    if d is null then
      perform public.fail('LEAVE_DECISION_MISSING', '미제출 지정 과제마다 처리 방법을 정해 주세요', jsonb_build_object('nodeId', p.node_id::text));
    end if;
    v_action := d ->> 'action';
    if v_action is null then          -- null 이면 `not in` 이 null 이 되어 통과해 버린다 → 결정 없음으로 본다
      perform public.fail('LEAVE_DECISION_MISSING', '미제출 지정 과제마다 처리 방법을 정해 주세요', jsonb_build_object('nodeId', p.node_id::text));
    end if;
    if v_action not in ('exclude', 'reassign') then
      perform public.fail('VALIDATION_FAILED', 'action 은 exclude 또는 reassign 이에요', jsonb_build_object('field', 'action', 'nodeId', p.node_id::text));
    end if;
    v_new := '{}'::uuid[];
    if v_action = 'reassign' then
      -- B9: assigneeIds 는 문자열 uuid 배열이어야 한다. 비문자열·잘못된 uuid 가 raw 22P02 로 새지 않게 한다
      v_bad := jsonb_typeof(coalesce(d -> 'assigneeIds', '[]'::jsonb)) <> 'array';
      if not v_bad then
        v_bad := exists (select 1 from jsonb_array_elements(coalesce(d -> 'assigneeIds', '[]'::jsonb)) x where jsonb_typeof(x) <> 'string');
      end if;
      if not v_bad then
        begin
          select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_new
          from jsonb_array_elements_text(coalesce(d -> 'assigneeIds', '[]'::jsonb)) x;
        exception when invalid_text_representation then
          v_bad := true;
        end;
      end if;
      if v_bad then
        perform public.fail('VALIDATION_FAILED', 'assigneeIds 는 uuid 문자열 배열이어야 해요', jsonb_build_object('field', 'assigneeIds', 'nodeId', p.node_id::text));
      end if;
      foreach v_id in array v_new loop
        if v_id = p_user or not exists (
             select 1 from public.room_members m
             where m.room_id = r.id and m.user_id = v_id and m.status = 'ACTIVE' and (m.role = 'MEMBER' or r.leader_does_tasks)) then
          perform public.fail('ASSIGNEE_NOT_MEMBER', '활성 참가자에게만 재지정할 수 있어요', jsonb_build_object('nodeId', p.node_id::text, 'userId', v_id::text));
        end if;
      end loop;
    end if;
    v_adds := array(select unnest(v_new) except select unnest(p.others));
    if cardinality(p.others) + cardinality(v_adds) = 0 then
      perform public.fail('REASSIGN_REQUIRED', '담당자가 0명이 되는 과제는 다른 참가자에게 재지정해야 해요', jsonb_build_object('nodeId', p.node_id::text));
    end if;
    v_plan := v_plan || jsonb_build_object('nodeId', p.node_id::text, 'adds', to_jsonb(v_adds));
  end loop;

  select coalesce(array_agg(ls.node_id), '{}') into v_open
  from public.room_leaf_stats(r.id) ls where ls.sub < ls.asg;

  -- 2. 대상 해제 + 상태 전환 + 정원
  update public.task_assignments a set released_at = now()
  from public.goal_nodes n
  where n.id = a.node_id and n.room_id = r.id and a.user_id = p_user and a.released_at is null;
  update public.room_members
     set status = 'INACTIVE', left_at = now(), decided_at = now(), decided_by = v_uid, updated_at = now()
   where room_id = r.id and user_id = p_user;
  perform public.room_release_seat(r.id);

  -- 3. 재지정
  for v_item in select e from jsonb_array_elements(v_plan) e loop
    select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_adds from jsonb_array_elements_text(v_item -> 'adds') x;
    if cardinality(v_adds) > 0 then
      insert into public.task_assignments (node_id, user_id, source)
      select (v_item ->> 'nodeId')::bigint, u, 'DESIGNATED' from unnest(v_adds) u
      on conflict (node_id, user_id) do update set released_at = null, source = 'DESIGNATED', assigned_at = now();
      -- A6: 호출부가 txid 를 붙인다(E1) — 없으면 키가 영구라 같은 사람의 이후 재지정이 dedupe 로 사라진다
      perform public.notify_publish('TASK_ASSIGNED', r.id, (v_item ->> 'nodeId')::bigint, v_uid, v_adds,
                                    'TASK_ASSIGNED:' || r.id || ':' || (v_item ->> 'nodeId') || ':' || txid_current(), '{}'::jsonb);
    end if;
  end loop;

  -- 4·5
  perform public.assignment_resync(r.id);
  perform public.notify_publish('MEMBER_DEACTIVATED', r.id, null, v_uid, array[p_user],
                                'MEMBER_DEACTIVATED:' || r.id || ':' || p_user, '{}'::jsonb);
  -- 6 (0013). 이탈로 남은 담당자 전원이 제출한 상태가 된 과제 → submission_upsert 와 같은 TASK_ALL_SUBMITTED(IMMEDIATE 만, 같은 dedupe 키).
  -- 행위자는 그룹장 자신이지만 상태 이벤트라 actor 는 null(그룹장이 수신자라 빠지면 안 된다)
  if (select coalesce(completion_mode, 'DAILY_DIGEST') from public.room_notification_settings where room_id = r.id) = 'IMMEDIATE' then
    for v_node in
      select ls.node_id from public.room_leaf_stats(r.id) ls
      where ls.node_id = any(v_open) and ls.asg > 0 and ls.sub = ls.asg order by ls.node_id
    loop
      perform public.notify_publish('TASK_ALL_SUBMITTED', r.id, v_node, null, array[r.leader_id],
                                    'TASK_ALL_SUBMITTED:' || r.id || ':' || v_node, '{}'::jsonb);
    end loop;
  end if;
  return public.membership_result(r.id, v_uid);
end $$;


-- ───────── 5b. (0005 room_transition_active) ─────────
create or replace function public.room_transition_active(p_room bigint, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_expired uuid[];
  v_members uuid[];
  v_round   bigint;
begin
  update public.rooms set status = 'ACTIVE', started_at = now(), updated_at = now()
  where id = p_room and status = 'RECRUIT';
  if not found then return; end if;

  with x as (
    update public.room_members set status = 'EXPIRED', decided_at = now(), updated_at = now()
    where room_id = p_room and status = 'PENDING'
    returning user_id)
  select coalesce(array_agg(user_id), '{}') into v_expired from x;

  perform public.assignment_resync(p_room);

  select coalesce(array_agg(user_id), '{}') into v_members
  from public.room_members where room_id = p_room and status = 'ACTIVE';

  if cardinality(v_expired) > 0 then
    perform public.notify_publish('JOIN_EXPIRED', p_room, null, p_actor, v_expired, 'JOIN_EXPIRED:' || p_room, '{}'::jsonb);
  end if;
  perform public.notify_publish('ROOM_STARTED', p_room, null, p_actor, v_members, 'ROOM_STARTED:' || p_room, '{}'::jsonb);

  -- 0013: 진행 중인 회차(오늘이 기간 안)의 ROUND_STARTED. 00:01 KST job_round_started 뒤에 수동 시작한 방은 잡이 놓친다.
  -- 잡과 같은 자연 키라 같은 날 잡이 다시 돌아도 중복되지 않는다. 상태 이벤트 → actor null(시작한 그룹장도 받는다)
  for v_round in
    select n.id from public.goal_nodes n
    where n.room_id = p_room and n.depth = 2 and n.archived_at is null
      and n.start_date <= public.kst_today() and n.end_date >= public.kst_today()
    order by n.sort_order, n.id
  loop
    perform public.notify_publish('ROUND_STARTED', p_room, v_round, null, v_members, 'ROUND_STARTED:' || p_room || ':' || v_round, '{}'::jsonb);
  end loop;
end $$;


-- ───────── 4. 기존 알림 백필 ─────────
-- 방 제목을 그대로 담은 본문을 새 규칙으로 다시 쓴다(일정 변경은 저장된 기간이 없어 과제 제목만). 대상은 0013 이전 행뿐
update public.notifications n set body = case
    when n.kind = 'ROUND_STARTED' then
      (select left(g.title, 500) from public.goal_nodes g where g.id = n.node_id and g.label is not null and g.title is distinct from g.label)
    when n.kind = 'SCHEDULE_CHANGED' then
      (select left(format('"%s"', g.title), 500) from public.goal_nodes g where g.id = n.node_id)
  end
from public.rooms r
where r.id = n.room_id and n.body = r.title;
