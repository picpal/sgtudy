import { describe, expect, it } from "vitest";
import type { RoomMemberDto } from "@/lib/api/types";
import { editorErrorText, editorRows } from "./editors";

const M = (userId: string, role: RoomMemberDto["role"], status: RoomMemberDto["status"], canEditCurriculum?: boolean): RoomMemberDto =>
  ({ userId, nickname: userId, tone: "mint", role, status, joinedAt: null, canEditCurriculum });

describe("curriculum editor rows", () => {
  const members = [M("a", "member", "active", true), M("lead", "leader", "active", true), M("b", "member", "active", false), M("c", "member", "inactive", true), M("d", "member", "pending")];

  it("puts the leader first and drops inactive / pending members", () => {
    expect(editorRows(members).map((r) => [r.userId, r.leader, r.on])).toEqual([["lead", true, true], ["a", false, true], ["b", false, false]]);
  });

  it("applies optimistic overrides to members only (leader is always on)", () => {
    const rows = editorRows(members, { a: false, b: true, lead: false });
    expect(rows.map((r) => r.on)).toEqual([true, false, true]);
  });

  it("treats a missing flag as no permission", () => {
    expect(editorRows([M("x", "member", "active")])[0].on).toBe(false);
  });

  it("maps grant errors to Korean copy", () => {
    expect(editorErrorText("NOT_LEADER", "지은")).toBe("그룹장만 편집 권한을 줄 수 있어요");
    expect(editorErrorText("MEMBER_NOT_ACTIVE", "지은")).toContain("지은 님은 지금 참가 중이 아니라서");
    expect(editorErrorText("CANNOT_TARGET_LEADER", "지은")).toBe("그룹장은 늘 편집할 수 있어요");
    expect(editorErrorText("ROOM_NOT_FOUND", "지은")).toBe("스터디를 찾을 수 없어요");
    expect(editorErrorText("UNKNOWN", "지은")).toContain("편집 권한을 바꾸지 못했어요");
  });
});
