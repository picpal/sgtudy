import { describe, expect, it } from "vitest";
import { closedAction, actionOf } from "@/lib/api/room-view";
import { inviteActionOf } from "@/lib/api/invite";
import { showApplications } from "@/lib/api/leader";
import { toRoomCard } from "@/lib/api/rooms";
import { codeInputView, extraRecruitDefaults, extraRecruitNote, formatCode, inviteNote, isCodeShape, normalizeCode, recruitMaxDate } from "@/lib/api/recruit";
import type { InvitePreview, RoomCardDto } from "@/lib/api/types";

describe("code", () => {
  it("normalizes like SQL invite_code_norm", () => {
    expect(normalizeCode(" k7qm-3xpa ")).toBe("K7QM3XPA");
    expect(normalizeCode("oIlL")).toBe("0111");
  });
  it("shape / format / typing view", () => {
    expect(isCodeShape("K7QM3XPA")).toBe(true);
    expect(isCodeShape("K7QM3XP")).toBe(false);
    expect(isCodeShape("K7QM3XPU")).toBe(false); // U 없음
    expect(formatCode("K7QM3XPA")).toBe("K7QM-3XPA");
    expect(codeInputView("k7q")).toBe("K7Q");
    expect(codeInputView("k7qm3")).toBe("K7QM-3");
    expect(codeInputView("k7qm-3xpa99")).toBe("K7QM-3XPA"); // 8자에서 자른다
  });
});

describe("closedAction / actionOf with extra window", () => {
  const base = { status: "active" as const, memberCount: 4, maxMembers: 6, joinMode: "approval" as const, me: { state: "none" as const } };
  it("active without window → activeClosed; with window → apply/join; full → full", () => {
    expect(closedAction(base)).toBe("activeClosed");
    expect(closedAction({ ...base, recruit: { open: true, extraUntil: "2026-10-19" } })).toBeNull();
    expect(actionOf({ ...base, recruit: { open: true, extraUntil: "2026-10-19" } })).toBe("apply");
    expect(actionOf({ ...base, joinMode: "direct", recruit: { open: true, extraUntil: "2026-10-19" } })).toBe("join");
    expect(closedAction({ ...base, memberCount: 6, recruit: { open: true, extraUntil: "2026-10-19" } })).toBe("full");
  });
  it("active member in extra window stays joined (no leave)", () => {
    expect(actionOf({ ...base, me: { state: "active" }, recruit: { open: true, extraUntil: "2026-10-19" } })).toBe("joined");
  });
});

describe("inviteActionOf with join", () => {
  const p = (over: Partial<InvitePreview> & { join?: InvitePreview["join"] }): InvitePreview => ({
    today: "2026-10-12",
    room: { slug: "aws", title: "t", intro: "", startDate: "2026-10-01", endDate: "2026-12-31", memberCount: 4, maxMembers: 6, status: "active", isPublic: true, joinMode: "approval", tags: [] },
    leader: { userId: "l", nickname: "민수", tone: "mint" },
    me: { state: "none" },
    ...over,
  });
  it("bypass → join even on approval room; PENDING can be promoted", () => {
    const j = { mode: "direct" as const, via: "invite" as const, until: "2026-10-19" };
    expect(inviteActionOf(p({ join: j }))).toBe("join");
    expect(inviteActionOf(p({ join: j, me: { state: "pending" } }))).toBe("join");
  });
  it("extra approval → apply; closed → activeClosed / ended; anon → login only when open", () => {
    expect(inviteActionOf(p({ join: { mode: "approval", via: "extra", until: "2026-10-19" } }))).toBe("apply");
    expect(inviteActionOf(p({ join: { mode: null, via: null, until: null } }))).toBe("activeClosed");
    expect(inviteActionOf(p({ join: { mode: null, via: null, until: null }, room: { ...p({}).room, status: "ended" } }))).toBe("ended");
    expect(inviteActionOf(p({ me: null, join: { mode: "direct", via: "invite", until: "2026-10-19" } }))).toBe("login");
    expect(inviteActionOf(p({ me: null, join: { mode: null, via: null, until: null } }))).toBe("activeClosed");
  });
  it("legacy preview without join keeps old rules", () => {
    expect(inviteActionOf(p({}))).toBe("activeClosed");
  });
});

describe("leader helpers", () => {
  it("showApplications in active room with window", () => {
    expect(showApplications({ status: "active", joinMode: "approval", pendingCount: 0, archived: false, recruit: { open: true, extraUntil: "2026-10-19" } })).toBe(true);
    expect(showApplications({ status: "active", joinMode: "approval", pendingCount: 0, archived: false, recruit: { open: false, extraUntil: null } })).toBe(false);
  });
  it("defaults & notes", () => {
    const d = { today: "2026-10-12", endDate: "2026-10-15", maxMembers: 6, memberCount: 6, joinMode: "approval" as const };
    expect(recruitMaxDate(d)).toBe("2026-10-15");
    expect(extraRecruitDefaults(d)).toEqual({ until: "2026-10-15", maxMembers: 7, joinMode: "approval" });
    expect(extraRecruitNote({ isPublic: false })).toContain("목록에는 안 보여요");
    expect(inviteNote({ status: "active", recruit: { open: false, extraUntil: null }, invite: { url: "/invite/x", token: "x", code: "K7QM3XPA", bypass: null }, isPublic: true })).toContain("지금은 이 링크로 참가할 수 없어요");
  });
});

describe("toRoomCard extra badge", () => {
  it("active + recruitUntil → extra", () => {
    const dto = { id: "6", slug: "aws", title: "t", intro: "", status: "active", isFull: false, isPublic: true, joinMode: "approval", memberCount: 4, maxMembers: 6,
      leader: { userId: "l", nickname: "민수", tone: "mint" }, tags: [], startDate: "2026-10-01", endDate: "2026-12-31", membership: null,
      progress: { kind: "team", currentRound: null, totalRounds: 13 }, recruitUntil: "2026-10-19" } as RoomCardDto;
    expect(toRoomCard(dto, "2026-10-12")).toMatchObject({ status: "active", extra: "open" });
    expect(toRoomCard({ ...dto, isFull: true }, "2026-10-12")).toMatchObject({ extra: "full" });
    expect(toRoomCard({ ...dto, recruitUntil: null }, "2026-10-12").extra).toBeUndefined();
  });
});
