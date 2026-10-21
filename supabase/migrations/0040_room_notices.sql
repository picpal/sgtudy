-- 0040_room_notices.sql — 2026-10-21 그룹장 공지사항(방 공지 탭 · 입장 팝업). 배포 후 수정 금지.
-- 스펙 docs/superpowers/specs/2026-10-21-room-notices-design.md (D1~D18 권장안).
-- 추가형: 표 2개(room_notices·room_notice_reads, RPC 전용) + RPC 6개 + 알림 종류 NOTICE_POSTED.
-- 재정의 원본: notification_kinds·notify_render·notify_link ← 0037 (0038·0039 재정의 없음). 시그니처 동일 → GRANT(없음) 유지.
-- notify_enabled(최신 0025)는 그대로 — 알 수 없는 kind 는 else true.
-- 절: 1 스키마 · 2 내부 헬퍼 · 3 읽기 RPC · 4 그룹장 쓰기 RPC · 5 GRANT · 6 알림 종류

-- ───────── 1. 스키마 (스펙 §4) ─────────
create table public.room_notices (
  id          bigint generated always as identity primary key,
  room_id     bigint not null references public.rooms(id) on delete cascade,
  author_id   uuid   references public.profiles(id) on delete set null,
  title       text   not null check (char_length(title) between 1 and 80),
  body_md     text   not null check (char_length(body_md) between 1 and 10000),
  popup       boolean not null default false,
  popup_rev   int     not null default 1,      -- "다시 알리기" 때 +1 (D4)
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()   -- 제목·본문이 바뀔 때만 (고정·팝업 토글은 '수정됨' 아님)
);
create index room_notices_room_idx on public.room_notices (room_id, pinned desc, created_at desc);

create table public.room_notice_reads (
  notice_id   bigint not null references public.room_notices(id) on delete cascade,
  user_id     uuid   not null references public.profiles(id) on delete cascade,
  read_rev    int    not null,                  -- 확인한 popup_rev (read_rev >= popup_rev 면 읽음)
  read_at     timestamptz not null default now(),
  primary key (notice_id, user_id)
);
create index room_notice_reads_user_idx on public.room_notice_reads (user_id);

alter table public.room_notices      enable row level security;
alter table public.room_notice_reads enable row level security;
revoke all on public.room_notices, public.room_notice_reads from anon, authenticated;   -- 정책 없음 = RPC 전용

-- ───────── 2. 내부 헬퍼 (GRANT 없음) ─────────
-- 상한(D11) — notice_list.limits 와 쓰기 검사가 같은 값을 본다
create or replace function public.notice_limits() returns jsonb
language sql immutable set search_path = '' as $$
  select '{"total":100,"pinned":3,"popup":5}'::jsonb
$$;

-- 열람자(D10): 그룹장 · ACTIVE · INACTIVE 멤버. 못 읽는 방 ROOM_NOT_FOUND, 읽을 수 있지만 위 셋이 아니면 NOT_MEMBER(PENDING 은 details.state)
create or replace function public.notice_reader_room(p_slug text) returns public.rooms
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  r     public.rooms;
  v_st  text;
begin
  select * into r from public.rooms where slug = p_slug;
  if not found or not public.room_readable(r.id, v_uid) then perform public.fail('ROOM_NOT_FOUND', '방을 찾을 수 없어요'); end if;
  if r.leader_id = v_uid then return r; end if;
  select m.status into v_st from public.room_members m where m.room_id = r.id and m.user_id = v_uid;
  if v_st in ('ACTIVE', 'INACTIVE') then return r; end if;
  if v_st = 'PENDING' then
    perform public.fail('NOT_MEMBER', '참가가 승인되면 공지를 볼 수 있어요', '{"state":"pending"}'::jsonb);
  end if;
  perform public.fail('NOT_MEMBER', '참가 중인 방이 아니에요');
end $$;

-- 쓰기 가능 상태(D12) — 0011 node_assert_editable 과 같은 조건·문구
create or replace function public.notice_assert_editable(r public.rooms) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if r.archived_at is not null or r.status not in ('DRAFT', 'RECRUIT', 'ACTIVE') then
    perform public.fail('ROOM_NOT_EDITABLE', '종료되었거나 보관된 방은 편집할 수 없어요', jsonb_build_object('status', lower(r.status)));
  end if;
end $$;

-- Notice JSON (스펙 §5). read = 보는 사람이 현재 리비전을 확인했는지
create or replace function public.notice_json(n public.room_notices, p_viewer uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id::text, 'title', n.title, 'bodyMd', n.body_md, 'popup', n.popup, 'pinned', n.pinned,
    'author', case when n.author_id is null then null else public.person_json(n.author_id) end,
    'createdAt', public.iso(n.created_at), 'updatedAt', public.iso(n.updated_at),
    'edited', n.updated_at > n.created_at + interval '1 minute',
    'rev', n.popup_rev,   -- 팝업 [확인] 이 본 리비전을 돌려 보낸다(notice_read p_revs)
    'read', exists (select 1 from public.room_notice_reads x where x.notice_id = n.id and x.user_id = p_viewer and x.read_rev >= n.popup_rev))
$$;

-- 보는 사람에게 안 읽은 공지가 있는지
create or replace function public.notice_unread(p_room bigint, p_viewer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_notices n
    where n.room_id = p_room
      and not exists (select 1 from public.room_notice_reads x where x.notice_id = n.id and x.user_id = p_viewer and x.read_rev >= n.popup_rev))
$$;

-- 확인 기록(멱등) — read_rev 는 줄지 않는다. p_rev = 화면이 본 리비전(그사이 다시 알리기로 올라간 리비전까지 읽음 처리하지 않게)
create or replace function public.notice_mark_read(p_notice bigint, p_user uuid, p_rev int default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.room_notice_reads (notice_id, user_id, read_rev)
  select n.id, p_user, least(coalesce(p_rev, n.popup_rev), n.popup_rev) from public.room_notices n where n.id = p_notice
  on conflict (notice_id, user_id) do update
    set read_rev = greatest(public.room_notice_reads.read_rev, excluded.read_rev), read_at = now()
$$;

-- 앞뒤 공백 — 스페이스뿐 아니라 줄바꿈·탭·NBSP·전각 공백까지(클라이언트 String.trim 과 같게)
create or replace function public.notice_trim(p text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(p, '^[\s\u00a0\u3000]+|[\s\u00a0\u3000]+$', '', 'g')
$$;

-- 게시 벨(D8): ACTIVE 멤버(그룹장·작성자 제외 — notify_publish 가 actor 를 뺀다). dedupe = NOTICE_POSTED:{id}:{rev}
create or replace function public.notice_notify(n public.room_notices, p_actor uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare v_rcpt uuid[];
begin
  select coalesce(array_agg(m.user_id), '{}') into v_rcpt
  from public.room_members m join public.rooms r on r.id = m.room_id
  where m.room_id = n.room_id and m.status = 'ACTIVE' and m.user_id <> r.leader_id;
  return public.notify_publish('NOTICE_POSTED', n.room_id, null, p_actor, v_rcpt,
                               'NOTICE_POSTED:' || n.id || ':' || n.popup_rev,
                               jsonb_build_object('noticeId', n.id::text, 'title', n.title));
end $$;

-- 입력 검증 — p_partial=false(작성)면 title·bodyMd 필수. 키 화이트리스트는 호출자가 넘긴다
create or replace function public.notice_validate(p_in jsonb, p_keys text[], p_partial boolean) returns void
language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if jsonb_typeof(p_in) is distinct from 'object' then
    perform public.fail('VALIDATION_FAILED', '공지 내용이 올바르지 않아요', '{"field":"input"}'::jsonb);
  end if;
  for k in select jsonb_object_keys(p_in) loop
    if not (k = any(p_keys)) then
      perform public.fail('VALIDATION_FAILED', '알 수 없는 항목이에요', jsonb_build_object('field', k));
    end if;
  end loop;
  if not p_partial or p_in ? 'title' then
    if jsonb_typeof(p_in -> 'title') is distinct from 'string' or char_length(public.notice_trim(p_in ->> 'title')) not between 1 and 80 then
      perform public.fail('VALIDATION_FAILED', '제목은 1~80자예요', '{"field":"title"}'::jsonb);
    end if;
  end if;
  if not p_partial or p_in ? 'bodyMd' then
    if jsonb_typeof(p_in -> 'bodyMd') is distinct from 'string' or public.notice_trim(p_in ->> 'bodyMd') = ''
       or char_length(p_in ->> 'bodyMd') > 10000 then
      perform public.fail('VALIDATION_FAILED', '본문은 1~10,000자예요', '{"field":"bodyMd"}'::jsonb);
    end if;
  end if;
  foreach k in array array['popup', 'pinned', 'renotify'] loop
    if p_in ? k and jsonb_typeof(p_in -> k) is distinct from 'boolean' then
      perform public.fail('VALIDATION_FAILED', '값이 올바르지 않아요', jsonb_build_object('field', k));
    end if;
  end loop;
end $$;

-- 상한 검사(D11). p_except = 수정 중인 공지(자기 자신은 세지 않는다)
create or replace function public.notice_assert_limit(p_room bigint, p_kind text, p_except bigint default null) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_max int := (public.notice_limits() ->> p_kind)::int;
  v_n   int;
begin
  select count(*) into v_n from public.room_notices n
  where n.room_id = p_room and n.id is distinct from p_except
    and case p_kind when 'pinned' then n.pinned when 'popup' then n.popup else true end;
  if v_n >= v_max then
    perform public.fail('NOTICE_LIMIT',
      case p_kind when 'pinned' then '고정은 3개까지예요' when 'popup' then '팝업 공지는 5개까지예요 · 오래된 공지의 팝업을 꺼 주세요'
                  else '공지는 100개까지예요' end,
      jsonb_build_object('kind', p_kind, 'max', v_max));
  end if;
end $$;

-- ───────── 3. 읽기 RPC ─────────
-- 고정 → 최신순 전체(≤100). canWrite = 그룹장 ∧ 쓰기 가능 상태. counts = 상한 대비 현재 개수
create or replace function public.notice_list(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r     public.rooms := public.notice_reader_room(p_slug);
  v_uid uuid := public.current_user_id();
begin
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(public.notice_json(n, v_uid) order by n.pinned desc, n.created_at desc, n.id desc)
                       from public.room_notices n where n.room_id = r.id), '[]'::jsonb),
    'canWrite', r.leader_id = v_uid and r.archived_at is null and r.status in ('DRAFT', 'RECRUIT', 'ACTIVE'),
    'limits', public.notice_limits(),
    'counts', (select jsonb_build_object('total', count(*), 'pinned', count(*) filter (where n.pinned), 'popup', count(*) filter (where n.popup))
               from public.room_notices n where n.room_id = r.id));
end $$;

-- 미읽음 여부 + 팝업 대기 큐(D5: 고정 → 오래된 순, ≤5). 팝업은 ACTIVE 멤버(그룹장 제외, D17)·종료/보관 아닌 방(D12)만
create or replace function public.notice_inbox(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r       public.rooms := public.notice_reader_room(p_slug);
  v_uid   uuid := public.current_user_id();
  v_popup boolean;
begin
  v_popup := r.leader_id <> v_uid and r.archived_at is null and r.status <> 'ENDED'
             and exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = v_uid and m.status = 'ACTIVE');
  return jsonb_build_object(
    'unread', public.notice_unread(r.id, v_uid),
    'popups', case when not v_popup then '[]'::jsonb else coalesce((
      select jsonb_agg(public.notice_json(q, v_uid) order by q.pinned desc, q.created_at, q.id)
      from (select n.* from public.room_notices n
            where n.room_id = r.id and n.popup
              and not exists (select 1 from public.room_notice_reads x where x.notice_id = n.id and x.user_id = v_uid and x.read_rev >= n.popup_rev)
            order by n.pinned desc, n.created_at, n.id limit 5) q), '[]'::jsonb) end);
end $$;

-- 확인 처리(팝업 [확인]·탭 펼침 공용, 멱등). 이 방 공지가 아닌 id·이미 지워진 id 는 건너뛴다(팝업이 열린 사이 삭제돼도 실패하지 않게).
-- p_revs(선택, p_ids 와 같은 순서) = 화면에 보인 리비전 — 없으면 지금 리비전
create or replace function public.notice_read(p_slug text, p_ids bigint[], p_revs int[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r     public.rooms := public.notice_reader_room(p_slug);
  v_uid uuid := public.current_user_id();
  v_id  bigint;
  v_rev int;
begin
  if coalesce(cardinality(p_ids), 0) > 100 then
    perform public.fail('VALIDATION_FAILED', '한 번에 100개까지 확인할 수 있어요', '{"field":"ids"}'::jsonb);
  end if;
  if p_revs is not null and cardinality(p_revs) is distinct from cardinality(p_ids) then
    perform public.fail('VALIDATION_FAILED', '확인할 공지와 리비전 수가 달라요', '{"field":"revs"}'::jsonb);
  end if;
  for v_id, v_rev in
    select n.id, min(t.rev) from public.room_notices n
    join unnest(coalesce(p_ids, '{}'), p_revs) as t(id, rev) on t.id = n.id
    where n.room_id = r.id group by n.id
  loop
    perform public.notice_mark_read(v_id, v_uid, v_rev);
  end loop;
  return jsonb_build_object('unread', public.notice_unread(r.id, v_uid));
end $$;

-- ───────── 4. 그룹장 쓰기 RPC (D1 그룹장만 · D12 종료/보관 읽기 전용) ─────────
-- p_input: { title, bodyMd, popup?, pinned? }
create or replace function public.notice_create(p_slug text, p_input jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r     public.rooms := public.leader_room(p_slug, true);
  v_uid uuid := public.current_user_id();
  n     public.room_notices;
begin
  perform public.notice_assert_editable(r);
  perform public.notice_validate(p_input, array['title', 'bodyMd', 'popup', 'pinned'], false);
  perform public.notice_assert_limit(r.id, 'total');
  if coalesce((p_input ->> 'pinned')::boolean, false) then perform public.notice_assert_limit(r.id, 'pinned'); end if;
  if coalesce((p_input ->> 'popup')::boolean, false) then perform public.notice_assert_limit(r.id, 'popup'); end if;
  insert into public.room_notices (room_id, author_id, title, body_md, popup, pinned)
  values (r.id, v_uid, public.notice_trim(p_input ->> 'title'), p_input ->> 'bodyMd',
          coalesce((p_input ->> 'popup')::boolean, false), coalesce((p_input ->> 'pinned')::boolean, false))
  returning * into n;
  perform public.notice_mark_read(n.id, v_uid);   -- 작성 = 읽음(D17)
  perform public.notice_notify(n, v_uid);
  return public.notice_json(n, v_uid);
end $$;

-- p_patch 키: title·bodyMd·popup·pinned·renotify. renotify=true → popup 켜고 popup_rev+1, 멤버 확인 초기화 효과 + 벨 재발행(D4·D8)
create or replace function public.notice_update(p_slug text, p_id bigint, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r      public.rooms := public.leader_room(p_slug, true);
  v_uid  uuid := public.current_user_id();
  n      public.room_notices;
  v_re   boolean;
  v_pop  boolean;
  v_pin  boolean;
begin
  perform public.notice_assert_editable(r);
  select * into n from public.room_notices where id = p_id and room_id = r.id for update;
  if not found then perform public.fail('NOTICE_NOT_FOUND', '공지를 찾을 수 없어요'); end if;
  perform public.notice_validate(p_patch, array['title', 'bodyMd', 'popup', 'pinned', 'renotify'], true);
  v_re  := coalesce((p_patch ->> 'renotify')::boolean, false);
  if v_re and (p_patch ->> 'popup')::boolean is false then   -- 다시 알리기는 팝업을 켠다 — 끄기와 함께 오면 뜻이 모호하다
    perform public.fail('VALIDATION_FAILED', '팝업을 끄면서 다시 알릴 수는 없어요', '{"field":"renotify"}'::jsonb);
  end if;
  v_pop := case when v_re then true else coalesce((p_patch ->> 'popup')::boolean, n.popup) end;
  v_pin := coalesce((p_patch ->> 'pinned')::boolean, n.pinned);
  if v_pin and not n.pinned then perform public.notice_assert_limit(r.id, 'pinned', n.id); end if;
  if v_pop and not n.popup  then perform public.notice_assert_limit(r.id, 'popup', n.id); end if;
  update public.room_notices x set
    title      = coalesce(public.notice_trim(p_patch ->> 'title'), x.title),
    body_md    = coalesce(p_patch ->> 'bodyMd', x.body_md),
    popup      = v_pop,
    pinned     = v_pin,
    popup_rev  = x.popup_rev + case when v_re then 1 else 0 end,
    updated_at = case when coalesce(public.notice_trim(p_patch ->> 'title'), x.title) is distinct from x.title
                        or coalesce(p_patch ->> 'bodyMd', x.body_md) is distinct from x.body_md then now() else x.updated_at end
  where x.id = n.id
  returning * into n;
  if v_re then
    perform public.notice_mark_read(n.id, v_uid);   -- 그룹장은 새 리비전도 읽음(D17)
    perform public.notice_notify(n, v_uid);
  end if;
  return public.notice_json(n, v_uid);
end $$;

-- 하드 삭제(D13) — room_notice_reads cascade. 이미 보낸 벨은 ?tab=notice 로 이어져 깨지지 않는다
create or replace function public.notice_delete(p_slug text, p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.rooms := public.leader_room(p_slug, true);
begin
  perform public.notice_assert_editable(r);
  delete from public.room_notices where id = p_id and room_id = r.id;
  if not found then perform public.fail('NOTICE_NOT_FOUND', '공지를 찾을 수 없어요'); end if;
end $$;

-- ───────── 5. GRANT (공개 RPC 만 — notice_* 헬퍼는 GRANT 없음) ─────────
grant execute on function public.notice_list(text)                 to authenticated;
grant execute on function public.notice_inbox(text)                to authenticated;
grant execute on function public.notice_read(text, bigint[], int[]) to authenticated;
grant execute on function public.notice_create(text, jsonb)        to authenticated;
grant execute on function public.notice_update(text, bigint, jsonb) to authenticated;
grant execute on function public.notice_delete(text, bigint)       to authenticated;

-- ───────── 6. 알림 종류 NOTICE_POSTED (notice_create·notice_update(renotify) 가 발행, 스펙 D8) ─────────
-- 재정의: notification_kinds·notify_render·notify_link ← 0037(0038·0039 재정의 없음). 시그니처 동일 → GRANT(없음) 유지.
-- notify_enabled(최신 0025)는 그대로 — 알 수 없는 kind 는 else true.
-- notification_kinds (0037 판 그대로 + NOTICE_POSTED)
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
               , 'CURRICULUM_BULK_UPDATED'
               -- 0037
               , 'EXAM_PUBLISHED'
               -- 0040
               , 'NOTICE_POSTED']
$$;

-- notify_render (0037 판 그대로 + NOTICE_POSTED 제목)
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
    -- 0037
    when 'EXAM_PUBLISHED'         then format('%s 「%s」 시험이 열렸어요', v_room, v_node)   -- 스펙 §4.6
    -- 0040: 공지 제목은 모델에 담아 온다(노드 없음). 본문 없음 — 방 제목은 프론트가 메타 줄에 그린다(0013)
    when 'NOTICE_POSTED'          then format('%s 새 공지: %s', v_room, p_model ->> 'title')
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
  -- 0037: 시험 발행 — 스펙 §4.6 "{방} 「{제목}」 시험이 열렸어요 · n문항 · ~MM.DD" 의 뒷부분(제목 · 본문 으로 나눠 그린다)
  if p_kind = 'EXAM_PUBLISHED' then
    v_body := format('%s문항 · ~%s', coalesce(p_model ->> 'count', '0'), to_char((select g.end_date from public.goal_nodes g where g.id = p_node), 'MM.DD'));
  end if;
  return jsonb_build_object('title', left(v_title, 200), 'body', left(v_body, 500));
end $$;

-- notify_link (0037 판 그대로 + NOTICE_POSTED → 공지 탭)
create or replace function public.notify_link(p_kind text, p_room bigint, p_node bigint, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_node is not null and p_kind in ('TASK_ALL_SUBMITTED', 'SUBMISSION_DIGEST')
      then '/my-study/' || r.slug || '?task=' || p_node || '#submissions'
    when p_node is not null and p_kind in ('DEADLINE_REMINDER', 'TASK_ASSIGNED', 'TASK_UNASSIGNED', 'PERSONAL_ARCHIVED', 'EXAM_PUBLISHED')   -- 0037: EXAM_PUBLISHED
      then '/my-study/' || r.slug || '?task=' || p_node
    -- 0028: 일정 변경 — 과제면 리프 포커스, 묶음(유형 없음)이면 진행목표 보기 상세
    when p_node is not null and p_kind = 'SCHEDULE_CHANGED'
      then '/my-study/' || r.slug || coalesce('?task=' || (select g.id from public.goal_nodes g where g.id = p_node and g.task_type is not null),
                                              '?tab=curriculum&item=' || p_node)
    when p_kind = 'NOTICE_POSTED' then '/my-study/' || r.slug || '?tab=notice'   -- 0040 (스펙 D14)
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
