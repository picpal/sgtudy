-- 0015_file_discard.sql — 제출에 연결되지 않은 내 첨부 정리 (task-submission 스펙 §1.7, R9 · D1 = 예)
-- 배포 후 수정 금지. 다른 함수는 고치지 않는다(새 함수 하나 + GRANT).
-- 화면에서 뺀 미연결 READY 첨부가 0007 file_register 의 "업로드 중 묶음 5개"(status in PENDING/READY ∧ submission_id is null ∧ 24시간)
-- 계산에 남아 재업로드를 막는다 → files 행을 DELETED 로 바꿔 그 계산에서 뺀다.
-- Storage 객체는 SQL 로 지우지 않는다(00 개요, 0008 job_cleanup 과 같은 규칙): DELETED 행은 2단계 Edge Function cleanup-files 가
--   Storage API remove() 후 정리한다. 클라이언트도 객체를 지우지 않는다(스펙 R13).
-- 본인(owner_user_id)의 ATTACHMENT 만, 남의 파일·없는 id 는 구분 없이 NOT_FOUND(존재 은닉).
-- 연결된 첨부(submission_id 있음)는 FILE_ATTACHED 로 거절: 제출에서 빼는 것은 submission_upsert 가 맡는다(0007 의 soft delete).
-- 이미 DELETED 면 그대로 같은 응답(멱등).
create or replace function public.file_discard(p_file uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.require_user();
  f     public.files;
begin
  select * into f from public.files
  where id = p_file and owner_user_id = v_uid and purpose = 'ATTACHMENT'
  for update;
  if not found then
    perform public.fail('NOT_FOUND', '첨부 파일을 찾을 수 없어요', jsonb_build_object('fileId', p_file::text));
  end if;
  if f.submission_id is not null then
    perform public.fail('FILE_ATTACHED', '제출에 붙은 파일은 제출을 고쳐서 빼 주세요', jsonb_build_object('fileId', p_file::text));
  end if;
  if f.status <> 'DELETED' then
    update public.files set status = 'DELETED', deleted_at = now() where id = p_file;
  end if;
  return jsonb_build_object('id', p_file::text, 'status', 'deleted');
end $$;

-- D7 GRANT 전용 모델(0002 default privileges 로 기본 비공개) — 로그인 사용자만
grant execute on function public.file_discard(uuid) to authenticated;
