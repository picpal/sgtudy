-- 0036_security_hardening.sql — 2026-10-21 접근제어 점검(.superpowers/sdd/security-review-2026-10-21.md) O1·G1 반영. 배포 후 수정 금지.

-- ───────── O1. 비로그인(anon) 의 전체 프로필 목록 차단 ─────────
-- 0003 은 public_profiles(id, nickname, avatar_tone) 를 anon 에도 열어 비공개 방에만 있는 사용자까지 나열됐다.
-- 비로그인 화면(공개 방·초대 랜딩·방 목록 카드)은 사람 정보를 security definer RPC(room_get·rooms_list·invite_preview·
-- task_get·curriculum_get → person_json) 의 JSON 으로만 받는다 → 뷰를 직접 읽는 앱 경로 없음. authenticated 는 그대로.
revoke all on public.public_profiles from anon;

-- ───────── G1. 첨부 객체 클라이언트 직접 삭제 경로 제거 ─────────
-- 작성자가 제출·노드에 붙은 객체를 Storage API 로 지울 수 있어 files=READY 인데 객체가 없는 깨진 링크가 생겼다.
-- 앱은 Storage delete 를 쓰지 않는다: 첨부 해제는 submission_upsert/file_discard, 객체 삭제는 cleanup-files(service_role, RLS 우회).
drop policy if exists attachments_delete_own on storage.objects;
