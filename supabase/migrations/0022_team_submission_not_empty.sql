-- 0022 팀 과제 빈 제출 서버 거부 (QA 2026-10-17, 오케스트레이터 결정)
-- 0007~0017 의 submission_upsert 는 유형과 관계없이 빈 내용(본문 공백·링크 0·첨부 0)을 받았다 — 팀 과제의 "하나는 있어야" 는 화면 규칙뿐이었다.
-- 결정: 팀 과제(COMMON·DESIGNATED)는 서버에서도 SUBMISSION_EMPTY 로 막는다. 개인 목표(PERSONAL)는 빈 저장 허용 유지.
-- 최신 판 0017 을 그대로 옮기고 빈 검사 한 덩어리만 더한다(0018~0021 은 이 함수를 재정의하지 않음). 추가형, GRANT 그대로.

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
  if v_today < n.start_date and n.task_type <> 'PERSONAL' then   -- 0017: 개인 목표는 시작일 전에도 제출
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
    if v_link is null or v_link !~* '^https?://[^[:space:]]+$' or length(v_link) > 2000 then
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

  -- 0022: 팀 과제는 본문·링크·첨부 중 하나는 있어야 한다(프론트 EMPTY_BLOCKER 와 같은 규칙·문구).
  -- 첨부는 이번 요청의 p_file_ids 기준 — file_register 가 먼저 READY 로 만들고 upsert 가 연결하므로(위에서 검증 끝남) 첨부만 있는 제출은 통과.
  -- 개인 목표는 빈 저장 허용: 완료(빈 제출)는 남고 그 뒤 personal_complete(false) 로 취소할 수 있다(QA Q1-2)
  if n.task_type <> 'PERSONAL' and v_body !~ '\S' and cardinality(v_links) = 0 and cardinality(v_files) = 0 then
    perform public.fail('SUBMISSION_EMPTY', '내용·링크·파일 중 하나는 있어야 해요', '{"field":"bodyMd"}'::jsonb);
  end if;

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

grant execute on function public.submission_upsert(bigint, text, text[], uuid[]) to authenticated;
