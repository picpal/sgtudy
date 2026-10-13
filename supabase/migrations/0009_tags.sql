-- 0009_tags.sql — 태그 사전 · 방 태그 · 자동 선택 (플랜 04 Task 8). 배포 후 수정 금지.

-- ───────── 사전 시드 (D12, cross-cutting §2.6). 운영 데이터이므로 seed.sql 이 아니라 마이그레이션에 둔다 ─────────
-- tone 은 src/data/room-view.ts·my-study.ts 의 태그 칩 색. aliases 는 자동 선택용 소문자 키워드(영숫자 2자 용어는 단어 경계가 있어야 맞는다 — tag_term_hit).
insert into public.tags (slug, label, tone, aliases, kind) values
  ('aws',             'AWS',        'mint',  array['amazon', '아마존', 'saa', 'iam', 'ec2', 's3', 'vpc', 'rds', 'dynamodb'], 'CURATED'),
  ('cloud',           '클라우드',    'blue',  array['cloud', '고가용성', '인프라', '오토스케일링', '로드밸런서'], 'CURATED'),
  ('certificate',   '자격증',      'peach', array['합격', '기출', '모의고사'], 'CURATED'),
  ('english',         '영어',        'blue',  array['english', '영단어', 'lc·rc'], 'CURATED'),
  ('toeic',           '토익',        'peach', array['toeic'], 'CURATED'),
  ('spring',          'Spring',     'lav',   array['스프링', 'jpa', '김영한', 'mvc'], 'CURATED'),
  ('backend',         '백엔드',      'blue',  array['backend', '서버', '서블릿'], 'CURATED'),
  ('java',            'Java',       'amber', array['자바'], 'CURATED'),
  ('algorithm',       '알고리즘',    'slate', array['백준', '프로그래머스', '그리디', 'bfs', 'dfs', '백트래킹', '최단경로'], 'CURATED'),
  ('coding-test',     '코딩테스트',  'mint',  array['코테', '문제 풀이', '1문제'], 'CURATED'),
  ('info-processing', '정보처리기사', 'amber', array['정처기', '실기'], 'CURATED'),
  ('cs',              'CS',         'amber', array['운영체제', '네트워크', 'computer science'], 'CURATED'),
  ('interview',       '면접',        'lav',   array['인터뷰', '모의 면접'], 'CURATED'),
  ('react',           'React',      'blue',  array['리액트', 'react.dev'], 'CURATED'),
  ('frontend',        '프론트엔드',  'mint',  array['frontend', '프론트'], 'CURATED'),
  ('docker',          'Docker',     'blue',  array['도커', '컨테이너'], 'CURATED'),
  ('kubernetes',      'Kubernetes', 'lav',   array['k8s', '쿠버네티스'], 'CURATED'),
  ('sql',             'SQL',        'amber', array['sqld', 'join', '서브쿼리', '윈도우 함수'], 'CURATED'),
  ('data',            '데이터',      'blue',  array['데이터 모델링', '데이터 분석'], 'CURATED')
on conflict (slug) do update set label = excluded.label, tone = excluded.tone, aliases = excluded.aliases, kind = excluded.kind;

-- ───────── usage_count 유지 ─────────
create or replace function public.room_tags_usage() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    update public.tags set usage_count = usage_count + 1 where slug = new.tag_slug;
    return new;
  elsif tg_op = 'DELETE' then
    update public.tags set usage_count = greatest(usage_count - 1, 0) where slug = old.tag_slug;
    return old;
  end if;
  return null;
end $$;
create trigger trg_room_tags_usage after insert or delete on public.room_tags
  for each row execute function public.room_tags_usage();
update public.tags t set usage_count = (select count(*) from public.room_tags rt where rt.tag_slug = t.slug);

-- ───────── 헬퍼 ─────────
-- 대소문자 무시. 영숫자 2자 용어(cs, s3, ps …)는 단어 경계가 있어야 맞는다 — 부분 일치면 'cs' ⊂ 'docs' 같은 오탐이 난다.
-- 그 밖(3자 이상, 한글)은 부분 일치(position — ILIKE 와일드카드 문제 회피). 한글은 조사가 붙으므로('합격까지') 경계를 요구하지 않는다.
-- 남는 한계: 3자 이상 부분 일치('데이터' ⊂ '데이터베이스')는 허용 — 점수 1 짜리라 상위 5 에 거의 영향 없음.
create or replace function public.tag_term_hit(p_text text, p_term text) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_text is null or length(trim(coalesce(p_term, ''))) < 2 then false
    when length(trim(p_term)) = 2 and trim(p_term) ~ '^[A-Za-z0-9]+$'
      then lower(p_text) ~ ('(^|[^a-z0-9])' || lower(trim(p_term)) || '($|[^a-z0-9])')
    else position(lower(trim(p_term)) in lower(p_text)) > 0
  end
$$;

-- 자유 입력 라벨 → slug. 같은 라벨(대소문자 무시)이 있으면 재사용, 없으면 CUSTOM 생성(slug = 'c-' || md5 앞 10자, tone = 라벨 해시)
create or replace function public.tag_slug_for(p_label text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_label text := trim(coalesce(p_label, '')); v_slug text;
begin
  if length(v_label) < 1 or length(v_label) > 20 then
    perform public.fail('VALIDATION_FAILED', '태그는 1~20자예요', jsonb_build_object('field', 'freeLabels', 'label', v_label));
  end if;
  select slug into v_slug from public.tags where lower(label) = lower(v_label);
  if found then return v_slug; end if;
  v_slug := 'c-' || left(md5(lower(v_label)), 10);
  insert into public.tags (slug, label, tone, aliases, kind)
  values (v_slug, v_label, (array['mint', 'blue', 'peach', 'lav', 'amber', 'slate'])[1 + (abs(hashtext(lower(v_label))) % 6)], '{}', 'CUSTOM')
  on conflict (slug) do nothing;
  return v_slug;
end $$;

-- ───────── 읽기 (03-api §7) ─────────
create or replace function public.tags_search(p_q text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(x.j), '[]'::jsonb))
  from (select jsonb_build_object('slug', t.slug, 'label', t.label, 'tone', t.tone, 'auto', false) as j
        from public.tags t
        where (t.kind = 'CURATED'
               -- CUSTOM 은 호출자가 읽을 수 있는 방에서 쓰일 때만(비공개·DRAFT 방의 자유 라벨이 공개 사전으로 새지 않게)
               or exists (select 1 from public.room_tags rt where rt.tag_slug = t.slug
                                and public.room_readable(rt.room_id, public.current_user_id())))
          and (nullif(trim(coalesce(p_q, '')), '') is null
           or t.label ilike '%' || public.like_escape(trim(p_q)) || '%'
           or exists (select 1 from unnest(t.aliases) a where a ilike '%' || public.like_escape(trim(p_q)) || '%'))
        order by t.usage_count desc, t.label
        limit 20) x
$$;

create or replace function public.room_tags_get(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.rooms;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, public.current_user_id()) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'items', public.room_tags_json(r.id));
end $$;

-- ───────── 수동 편집 (그룹장, 전체 교체, ≤8) ─────────
-- 목록에서 빠진 AUTO 태그는 억제 목록에 넣고, 목록에 있는 태그는 억제를 푼다. 목록의 태그는 전부 MANUAL
create or replace function public.room_tags_put(p_slug text, p_slugs text[] default '{}', p_free_labels text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms; v_slugs text[] := '{}'; v_s text; v_lab text;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);
  if r.archived_at is not null or r.status = 'ENDED' then perform public.fail('ROOM_NOT_EDITABLE', '종료되거나 보관된 스터디의 태그는 바꿀 수 없어요'); end if;
  foreach v_s in array coalesce(p_slugs, '{}') loop
    if not exists (select 1 from public.tags where slug = v_s) then
      perform public.fail('NOT_FOUND', '없는 태그예요', jsonb_build_object('field', 'slugs', 'slug', v_s));
    end if;
    if not (v_s = any(v_slugs)) then v_slugs := v_slugs || v_s; end if;
  end loop;
  foreach v_lab in array coalesce(p_free_labels, '{}') loop
    v_s := public.tag_slug_for(v_lab);
    if not (v_s = any(v_slugs)) then v_slugs := v_slugs || v_s; end if;
  end loop;
  if cardinality(v_slugs) > 8 then perform public.fail('TAG_LIMIT_EXCEEDED', '태그는 8개까지예요', '{"field":"slugs"}'::jsonb); end if;

  insert into public.room_tag_suppressions (room_id, tag_slug)
  select r.id, rt.tag_slug from public.room_tags rt
  where rt.room_id = r.id and rt.source = 'AUTO' and not (rt.tag_slug = any(v_slugs))
  on conflict do nothing;
  delete from public.room_tag_suppressions where room_id = r.id and tag_slug = any(v_slugs);

  delete from public.room_tags where room_id = r.id and not (tag_slug = any(v_slugs));
  insert into public.room_tags (room_id, tag_slug, source, sort_order)
  select r.id, s.slug, 'MANUAL', s.ord - 1 from unnest(v_slugs) with ordinality as s(slug, ord)
  on conflict (room_id, tag_slug) do update set source = 'MANUAL', sort_order = excluded.sort_order;

  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'items', public.room_tags_json(r.id));
end $$;

-- ───────── 자동 선택 (D12, mystudy §2.5) ─────────
-- 머지: 사전에 있고 억제되지 않은 slug 만, 최대 5. AUTO 는 전부 교체, MANUAL 보존, 방당 8개 안에서만 추가. LLM(Edge Function)도 이 함수를 쓴다
create or replace function public.tag_apply_auto(p_room bigint, p_slugs text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_slugs text[]; v_room int;
begin
  perform 1 from public.rooms where id = p_room for update;
  if not found then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  select coalesce(array_agg(s.slug order by s.ord), '{}') into v_slugs
  from (select distinct on (x.slug) x.slug, x.ord from unnest(coalesce(p_slugs, '{}')) with ordinality as x(slug, ord) order by x.slug, x.ord) s
  join public.tags t on t.slug = s.slug and t.kind = 'CURATED'
  where not exists (select 1 from public.room_tag_suppressions sp where sp.room_id = p_room and sp.tag_slug = s.slug);
  v_slugs := v_slugs[1:5];

  delete from public.room_tags where room_id = p_room and source = 'AUTO' and not (tag_slug = any(v_slugs));

  select 8 - count(*) into v_room from public.room_tags where room_id = p_room;
  insert into public.room_tags (room_id, tag_slug, source, sort_order)
  select p_room, s.slug, 'AUTO', 100 + s.ord
  from unnest(v_slugs) with ordinality as s(slug, ord)
  where not exists (select 1 from public.room_tags rt where rt.room_id = p_room and rt.tag_slug = s.slug)
  order by s.ord
  limit greatest(v_room, 0);
  return public.room_tags_json(p_room);
end $$;

-- 키워드 점수: 제목 3, 소개 2, 노드 제목 모음 1 (용어별 합). score > 0 상위 5 → tag_apply_auto.
-- 호출처: plan 03 node_update 의 가드(title/descriptionMd 변경 시), room_tags_suggest(그룹장 "다시 고르기"). room_create/room_update 에는 훅이 없다(S6)
create or replace function public.tag_autoselect(p_room bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare v_title text; v_intro text; v_nodes text; v_slugs text[];
begin
  select r.title, r.intro into v_title, v_intro from public.rooms r where r.id = p_room;
  if not found then return 0; end if;
  select string_agg(n.title, ' ' order by n.sort_order, n.id) into v_nodes
  from public.goal_nodes n where n.room_id = p_room and n.archived_at is null;

  select coalesce(array_agg(h.slug order by h.score desc, h.slug), '{}') into v_slugs
  from (
    select t.slug,
           sum(case when public.tag_term_hit(v_title, x.term) then 3 else 0 end
             + case when public.tag_term_hit(v_intro, x.term) then 2 else 0 end
             + case when public.tag_term_hit(v_nodes, x.term) then 1 else 0 end) as score
    from public.tags t
    cross join lateral unnest(array_append(t.aliases, t.label)) as x(term)
    where t.kind = 'CURATED'
    group by t.slug
    having sum(case when public.tag_term_hit(v_title, x.term) then 3 else 0 end
             + case when public.tag_term_hit(v_intro, x.term) then 2 else 0 end
             + case when public.tag_term_hit(v_nodes, x.term) then 1 else 0 end) > 0
    order by 2 desc, 1
    limit 5) h;
  perform public.tag_apply_auto(p_room, v_slugs);
  return cardinality(v_slugs);
end $$;

-- 그룹장이 "다시 고르기" 를 누를 때(03-api §7 suggest 의 SQL 경로). LLM 경로는 Edge Function suggest-tags(Task 9)
create or replace function public.room_tags_suggest(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.require_user(); r public.rooms;
begin
  r := public.room_lock(p_slug);
  perform public.require_leader(r, v_uid);
  if r.archived_at is not null or r.status = 'ENDED' then perform public.fail('ROOM_NOT_EDITABLE', '종료되거나 보관된 스터디의 태그는 바꿀 수 없어요'); end if;
  perform public.tag_autoselect(r.id);
  return jsonb_build_object('today', to_char(public.kst_today(), 'YYYY-MM-DD'), 'items', public.room_tags_json(r.id));
end $$;

-- ───────── 공개 RPC (D7 GRANT 전용) ─────────
grant execute on function public.tags_search(text)                    to anon, authenticated;
grant execute on function public.room_tags_get(text)                 to anon, authenticated;
grant execute on function public.room_tags_put(text, text[], text[])  to authenticated;
grant execute on function public.room_tags_suggest(text)              to authenticated;
-- Edge Function suggest-tags(Task 9)가 service_role 로 머지 함수를 부른다. 사용자 역할에는 열지 않는다
grant execute on function public.tag_apply_auto(bigint, text[])       to service_role;
