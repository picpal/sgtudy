import type { RoomMemberDto } from "@/lib/api/types";

/** 그룹장 "멤버 관리" 한 줄 — 그룹장은 늘 편집 가능(스위치 없음), ACTIVE 멤버만 스위치 */
export type EditorRow = { userId: string; name: string; tone: RoomMemberDto["tone"]; leader: boolean; on: boolean };

/** room_get.members → 멤버 관리 줄 (그룹장 먼저, 이탈·승인 대기 제외). ov = 낙관적 토글 값 */
export function editorRows(members: RoomMemberDto[], ov: Record<string, boolean> = {}): EditorRow[] {
  const rows = members
    .filter((m) => m.role === "leader" || m.status === "active")
    .map((m) => ({ userId: m.userId, name: m.nickname, tone: m.tone, leader: m.role === "leader", on: m.role === "leader" || (ov[m.userId] ?? !!m.canEditCurriculum) }));
  return [...rows.filter((r) => r.leader), ...rows.filter((r) => !r.leader)];
}

/** member_set_curriculum_editor 오류 → 토스트 문구 */
export function editorErrorText(code: string, name: string): string {
  switch (code) {
    case "NOT_LEADER":
      return "그룹장만 편집 권한을 줄 수 있어요";
    case "MEMBER_NOT_ACTIVE":
      return `${name} 님은 지금 참가 중이 아니라서 편집 권한을 바꿀 수 없어요`;
    case "CANNOT_TARGET_LEADER":
      return "그룹장은 늘 편집할 수 있어요";
    case "ROOM_NOT_FOUND":
      return "스터디를 찾을 수 없어요";
    default:
      return "편집 권한을 바꾸지 못했어요 · 잠시 후 다시 시도해 주세요";
  }
}
