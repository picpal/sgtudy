import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import {
  absoluteUrl,
  approveApplicant,
  fetchApplications,
  fetchInvite,
  leaderErrorText,
  openRecruit,
  openRecruitNote,
  rejectApplicant,
  rotateInvite,
  showApplications,
  startRoom,
  statusActionOf,
  statusStepLabel,
} from "./leader";

const fake = () => {
  const calls: [string, Record<string, unknown>][] = [];
  const client = { rpc: (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return Promise.resolve({ data: {}, error: null }); } } as unknown as Db;
  return { calls, client };
};

describe("statusActionOf", () => {
  it("draft → openRecruit, recruit → start, active/ended → none", () => {
    expect(statusActionOf({ status: "draft", archived: false })).toBe("openRecruit");
    expect(statusActionOf({ status: "recruit", archived: false })).toBe("start");
    expect(statusActionOf({ status: "active", archived: false })).toBeNull();
    expect(statusActionOf({ status: "ended", archived: false })).toBeNull();
  });
  it("archived room has no action", () => expect(statusActionOf({ status: "draft", archived: true })).toBeNull());
});

describe("openRecruitNote", () => {
  it("public + direct", () => expect(openRecruitNote({ isPublic: true, joinMode: "direct" })).toBe("전체 공개 방 목록에 보이고 누구나 바로 참가할 수 있어요"));
  it("private + approval", () =>
    expect(openRecruitNote({ isPublic: false, joinMode: "approval" })).toBe("목록에는 안 보이고 초대 링크를 받은 사람만 참가 신청할 수 있어요 · 신청은 여기서 승인해요"));
});

describe("showApplications", () => {
  const d = { status: "recruit" as const, joinMode: "approval" as const, pendingCount: 0, archived: false };
  it("approval-mode recruit room shows the list even when empty", () => expect(showApplications(d)).toBe(true));
  it("direct room only when someone is still pending", () => {
    expect(showApplications({ ...d, joinMode: "direct" })).toBe(false);
    expect(showApplications({ ...d, joinMode: "direct", pendingCount: 2 })).toBe(true);
  });
  it("not outside recruit or when archived", () => {
    expect(showApplications({ ...d, status: "draft" })).toBe(false);
    expect(showApplications({ ...d, status: "active", pendingCount: 1 })).toBe(false);
    expect(showApplications({ ...d, archived: true })).toBe(false);
  });
});

describe("leader RPC wiring", () => {
  it("passes slug / user to the right RPCs", async () => {
    const { calls, client } = fake();
    await openRecruit("r1", client);
    await startRoom("r1", client);
    await fetchInvite("r1", client);
    await rotateInvite("r1", client);
    await fetchApplications("r1", client);
    await approveApplicant("r1", "u9", client);
    await rejectApplicant("r1", "u9", client);
    expect(calls).toEqual([
      ["room_open_recruit", { p_slug: "r1" }],
      ["room_start", { p_slug: "r1" }],
      ["invite_get", { p_slug: "r1" }],
      ["invite_rotate", { p_slug: "r1" }],
      ["room_applications", { p_slug: "r1" }],
      ["room_approve", { p_slug: "r1", p_user: "u9" }],
      ["room_reject", { p_slug: "r1", p_user: "u9" }],
    ]);
  });
});

describe("helpers", () => {
  it("absoluteUrl joins the invite path to the origin", () => expect(absoluteUrl("/invite/abc", "http://k1.localhost:3800")).toBe("http://k1.localhost:3800/invite/abc"));
  it("statusStepLabel", () => expect(["draft", "recruit", "active", "ended"].map((s) => statusStepLabel(s as "draft"))).toEqual(["준비중", "모집중", "진행중", "종료"]));
  it("leaderErrorText: no-leaf hint uses 진행목표, unknown codes keep the server message", () => {
    expect(leaderErrorText("ROOM_NO_LEAF_TASK", "x")).toBe("진행목표에 과제를 1개 이상 만들어야 모집을 시작할 수 있어요");
    expect(leaderErrorText("ROOM_FULL", "x")).toBe("정원이 가득 차서 승인할 수 없어요");
    expect(leaderErrorText("INVALID_PERIOD", "종료일이 이미 지났어요")).toBe("종료일이 이미 지났어요");
    expect(leaderErrorText("X", "")).toBe("처리하지 못했어요 · 잠시 후 다시 시도해 주세요");
  });
});
