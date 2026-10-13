import { describe, expect, it } from "vitest";
import type { InvitePreview } from "./types";
import { inviteActionOf } from "./invite";

const base: InvitePreview = {
  today: "2026-10-12",
  room: { slug: "cs", title: "CS 면접", intro: "", startDate: "2026-10-19", endDate: "2026-11-30", memberCount: 3, maxMembers: 6, status: "recruit", isPublic: true, joinMode: "direct", tags: [] },
  leader: { userId: "u-yerin", nickname: "예린", tone: "amber" },
  me: { state: "none" },
};
const w = (p: Partial<InvitePreview["room"]>, me: InvitePreview["me"] = { state: "none" }): InvitePreview => ({ ...base, room: { ...base.room, ...p }, me });

describe("inviteActionOf (03-api §3 순서)", () => {
  it("anonymous → login", () => expect(inviteActionOf(w({}, null))).toBe("login"));
  it("leader → owner", () => expect(inviteActionOf(w({}, { state: "leader" }))).toBe("owner"));
  it("active member on recruit room → joined (초대 화면엔 취소 없음)", () => expect(inviteActionOf(w({}, { state: "active" }))).toBe("joined"));
  it("pending → pending", () => expect(inviteActionOf(w({ joinMode: "approval" }, { state: "pending" }))).toBe("pending"));
  it("inactive member → inactive (not join/apply)", () => {
    expect(inviteActionOf(w({}, { state: "inactive" }))).toBe("inactive");
    expect(inviteActionOf(w({ joinMode: "approval" }, { state: "inactive" }))).toBe("inactive");
  });
  it("ended / active / full", () => {
    expect(inviteActionOf(w({ status: "ended" }))).toBe("ended");
    expect(inviteActionOf(w({ status: "active" }))).toBe("activeClosed");
    expect(inviteActionOf(w({ memberCount: 6 }))).toBe("full");
  });
  it("approval → apply, direct → join", () => {
    expect(inviteActionOf(w({ joinMode: "approval" }))).toBe("apply");
    expect(inviteActionOf(w({}))).toBe("join");
  });
});
