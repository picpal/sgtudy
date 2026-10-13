-- 0007_submissions.sql — 과제 제출 · 첨부 · 과제 상세 (플랜 04 Task 2~4)
-- 배포 후 수정 금지. Task 3·4 가 이 파일 끝에 이어 붙인다.

-- ───────── "지금" (D5 지각 판정, 테스트는 app.now 로 고정) ─────────
create or replace function public.app_now() returns timestamptz
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('app.now', true), '')::timestamptz, now())
$$;

-- ───────── 제한값 (D10) ─────────
create or replace function public.allowed_mime_types() returns text[]
language sql immutable set search_path = '' as $$
  select array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf',
               'application/zip', 'application/x-zip-compressed', 'text/plain', 'text/markdown']
$$;

-- ───────── Storage 래퍼 (D15: Supabase 전용 기능은 얇은 래퍼로 격리) ─────────
create or replace function public.storage_exists(p_bucket text, p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from storage.objects o where o.bucket_id = p_bucket and o.name = p_path)
$$;

-- ───────── JSON 빌더 (03-api §5 FileMeta · Submission) ─────────
create or replace function public.file_json(p_file public.files) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', p_file.id::text, 'name', p_file.original_name, 'contentType', p_file.content_type,
                            'size', p_file.size_bytes, 'status', lower(p_file.status))
$$;

-- links 는 sort_order 순, files 는 READY 만 created_at 순
create or replace function public.submission_json(p_sub bigint) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id::text, 'bodyMd', s.body_md,
    'links', coalesce((select jsonb_agg(l.url order by l.sort_order) from public.submission_links l where l.submission_id = s.id), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(public.file_json(f) order by f.created_at, f.id)
                       from public.files f where f.submission_id = s.id and f.status = 'READY'), '[]'::jsonb),
    'firstSubmittedAt', public.iso(s.first_submitted_at), 'isLate', s.is_late, 'updatedAt', public.iso(s.updated_at))
  from public.submissions s where s.id = p_sub
$$;

-- ───────── 제출 대상 리프 공통 선행 검사 (submission_upsert · file_register) ─────────
-- 방 잠금(room_lock — node_delete·member_deactivate·settings_put 과 직렬화, 그사이 삭제되면 NODE_NOT_FOUND)
-- → 존재 은닉 → 방 ACTIVE·미보관 → 보관(비리프 PARENT_ARCHIVED / 리프 TASK_ARCHIVED) → 리프 → 담당자(released 아님).
-- 내부 전용(GRANT 없음). 시작일 검사는 호출자 몫(제출만 TASK_NOT_STARTED)
create or replace function public.submission_target(p_node bigint, p_uid uuid) returns public.goal_nodes
language plpgsql security definer set search_path = '' as $$
declare
  v_room bigint;
  v_slug text;
  r      public.rooms;
  n      public.goal_nodes;
begin
  select room_id into v_room from public.goal_nodes where id = p_node;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  select slug into v_slug from public.rooms where id = v_room;
  r := public.room_lock(v_slug);
  select * into n from public.goal_nodes where id = p_node;
  if not found then perform public.fail('NODE_NOT_FOUND', '과제를 찾을 수 없어요'); end if;
  perform public.room_hide_unless_known(r, p_uid);
  if r.status <> 'ACTIVE' or r.archived_at is not null then
    perform public.fail('ROOM_NOT_ACTIVE', '진행중인 스터디에서만 제출할 수 있어요');
  end if;
  if n.archived_at is not null then
    if n.task_type is null then perform public.fail('PARENT_ARCHIVED', '보관된 항목이에요', jsonb_build_object('nodeId', n.id::text)); end if;
    perform public.fail('TASK_ARCHIVED', '보관된 과제에는 제출할 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  if n.task_type is null then
    perform public.fail('NODE_NOT_LEAF', '하위 항목이 있는 노드에는 제출할 수 없어요', jsonb_build_object('nodeId', n.id::text));
  end if;
  if not public.is_task_assignee(n.id, p_uid) then
    perform public.fail('TASK_NOT_ASSIGNED', '이 과제의 담당자가 아니에요');
  end if;
  return n;
end $$;

-- ───────── submission_upsert (D10, mystudy §2.2) ─────────
-- 선행: submission_target(잠금·은닉·방 ACTIVE·보관·리프·담당자) + today ≥ start_date.
-- 최초 제출만 first_submitted_at/is_late 를 정한다(이후 갱신은 본문·링크·첨부만, I9 트리거가 두 컬럼 변경을 막는다).
-- 링크는 전부 교체, 첨부는 목록대로 연결하고 빠진 첨부는 soft delete(status=DELETED). Storage 객체는 SQL 로 지우지 않는다(00 개요 — 2단계 Edge Function).
-- 첨부마다 files 행(본인·이 리프·READY) + storage.objects 실재(D10 "존재 재검증")를 확인한다 — 등록 후 소유자가 attachments_delete_own 정책으로 객체를 지웠으면 FILE_NOT_READY.
create or replace function public.submission_upsert(p_node bigint, p_body text, p_links text[], p_file_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := public.require_user();
  v_today date := public.kst_today();
  v_now   timestamptz := public.app_now();
  n       public.goal_nodes;
  r       public.rooms;
  v_body  text := coalesce(p_body, '');
  v_links text[] := coalesce(p_links, '{}');
  v_files uuid[] := coalesce(p_file_ids, '{}');
  v_link  text;
  v_fid   uuid;
  v_fst   text;
  v_fpath text;
  v_fbkt  text;
  v_sid   bigint;
  v_new   boolean;
  v_asg   int;
  v_sub   int;
  v_mode  text;
  i       int;
begin
  n := public.submission_target(p_node, v_uid);
  select * into r from public.rooms where id = n.room_id;
  if v_today < n.start_date then
    perform public.fail('TASK_NOT_STARTED', '아직 시작되지 않은 과제예요', jsonb_build_object('startDate', to_char(n.start_date, 'YYYY-MM-DD')));
  end if;

  if length(v_body) > 50000 then
    perform public.fail('VALIDATION_FAILED', '본문은 50,000자까지예요', '{"field":"bodyMd"}'::jsonb);
  end if;
  if cardinality(v_links) > 20 then
    perform public.fail('INVALID_LINK', '링크는 20개까지예요', '{"field":"links","reason":"count"}'::jsonb);
  end if;
  for i in 1 .. cardinality(v_links) loop
    v_link := trim(v_links[i]);
    if v_link !~* '^https?://[^[:space:]]+$' or length(v_link) > 2000 then
      perform public.fail('INVALID_LINK', 'http(s):// 로 시작하는 링크만 넣을 수 있어요', jsonb_build_object('field', 'links', 'index', i - 1));
    end if;
    v_links[i] := v_link;
  end loop;
  if cardinality(v_files) > 5 then
    perform public.fail('FILE_LIMIT_EXCEEDED', '첨부는 5개까지예요', '{"field":"fileIds"}'::jsonb);
  end if;
  foreach v_fid in array v_files loop
    select status, bucket_id, object_path into v_fst, v_fbkt, v_fpath from public.files
    where id = v_fid and owner_user_id = v_uid and node_id = n.id and purpose = 'ATTACHMENT';
    if not found then perform public.fail('NOT_FOUND', '첨부 파일을 찾을 수 없어요', jsonb_build_object('fileId', v_fid::text)); end if;
    if v_fst <> 'READY' or not public.storage_exists(v_fbkt, v_fpath) then
      perform public.fail('FILE_NOT_READY', '업로드가 끝나지 않은 파일이 있어요', jsonb_build_object('fileId', v_fid::text));
    end if;
  end loop;

  -- xmax = 0 이면 INSERT 된 행(최초 제출). ON CONFLICT 분기는 first_submitted_at/is_late 를 건드리지 않는다
  insert into public.submissions (node_id, user_id, body_md, first_submitted_at, is_late, updated_at)
  values (n.id, v_uid, v_body, v_now, v_now >= public.kst_deadline(n.end_date), v_now)
  on conflict (node_id, user_id) do update set body_md = excluded.body_md
  returning id, (xmax = 0) into v_sid, v_new;

  delete from public.submission_links where submission_id = v_sid;
  insert into public.submission_links (submission_id, url, sort_order)
  select v_sid, u.url, u.ord - 1 from unnest(v_links) with ordinality as u(url, ord);

  update public.files set submission_id = null, status = 'DELETED', deleted_at = now()
  where submission_id = v_sid and status = 'READY' and not (id = any(v_files));
  update public.files set submission_id = v_sid where id = any(v_files);

  -- 전원 제출 감지: 최초 제출일 때만 sub 가 바뀐다. IMMEDIATE 면 지금, DAILY_DIGEST 면 job_completion_digest(0008) 가 어제 완료분을 모은다
  if v_new then
    select ls.asg, ls.sub into v_asg, v_sub from public.room_leaf_stats(r.id) ls where ls.node_id = n.id;
    if coalesce(v_asg, 0) > 0 and v_sub = v_asg then
      select completion_mode into v_mode from public.room_notification_settings where room_id = r.id;
      if coalesce(v_mode, 'DAILY_DIGEST') = 'IMMEDIATE' then
        perform public.notify_publish('TASK_ALL_SUBMITTED', r.id, n.id, v_uid, array[r.leader_id],
                                      'TASK_ALL_SUBMITTED:' || r.id || ':' || n.id, '{}'::jsonb);
      end if;
    end if;
  end if;

  return public.submission_json(v_sid);
end $$;
