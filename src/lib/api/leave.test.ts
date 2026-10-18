import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import type { RoomMemberDto } from "./types";
import {
  cancelLeaveRequest,
  deactivateMember,
  decisionsOf,
  dismissLeaveRequest,
  fetchLeaveRequests,
  initialChoices,
  leaveErrorText,
  missingChoices,
  previewDeactivate,
  reassignCandidates,
  requestLeave,
  requestedOn,
  type DeactivatePreview,
} from "./leave";

const fake = () => {
  const calls: [string, Record<string, unknown>][] = [];
  const client = { rpc: (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return Promise.resolve({ data: {}, error: null }); } } as unknown as Db;
  return { calls, client };
};

// 시나리오 QA D3 — 멤버 탈퇴 요청 / 그룹장 내보내기 (0024 계약 §3)
describe("탈퇴 요청·내보내기 RPC", () => {
  it("인자를 계약대로 넘긴다 — 사유는 다듬고 빈 값은 null", async () => {
    const { calls, client } = fake();
    await requestLeave("r1", "  이사 가요 ", client);
    await requestLeave("r1", "   ", client);
    await cancelLeaveRequest("r1", client);
    await fetchLeaveRequests("r1", client);
    await dismissLeaveRequest("r1", "u2", client);
    await previewDeactivate("r1", "u2", client);
    await deactivateMember("r1", "u2", [{ nodeId: "5", action: "exclude" }], client);
    expect(calls).toEqual([
      ["member_leave_request", { p_slug: "r1", p_reason: "이사 가요" }],
      ["member_leave_request", { p_slug: "r1", p_reason: null }],
      ["member_leave_request_cancel", { p_slug: "r1" }],
      ["room_leave_requests", { p_slug: "r1" }],
      ["member_leave_request_dismiss", { p_slug: "r1", p_user: "u2" }],
      ["member_deactivate_preview", { p_slug: "r1", p_user: "u2" }],
      ["member_deactivate", { p_slug: "r1", p_user: "u2", p_decisions: [{ nodeId: "5", action: "exclude" }] }],
    ]);
  });

  it("requestedOn: 요청 시각(ISO) → KST 날짜 표기", () => {
    expect(requestedOn("2026-10-12T16:30:00.000Z", "2026-10-13")).toBe("10.13");
    expect(requestedOn("2025-12-31T01:00:00.000Z", "2026-10-13")).toBe("2025.12.31");
  });

  it("leaveErrorText: 코드별 문구, 모르는 코드는 서버 문구", () => {
    expect(leaveErrorText("LEAVE_ALREADY_REQUESTED", "x")).toBe("이미 탈퇴를 요청했어요 · 그룹장이 처리할 때까지 기다려 주세요");
    expect(leaveErrorText("REASSIGN_REQUIRED", "x")).toBe("담당자가 없어지는 과제는 다른 참가자에게 맡기거나 담당 미정으로 두기를 골라 주세요");
    expect(leaveErrorText("ROOM_NOT_ACTIVE", "진행 중인 스터디에서만 탈퇴를 요청할 수 있어요")).toBe("진행 중인 스터디에서만 탈퇴를 요청할 수 있어요");
    expect(leaveErrorText("", "")).toBe("처리하지 못했어요 · 잠시 후 다시 시도해 주세요");
  });
});

const m = (userId: string, role: "leader" | "member", status: RoomMemberDto["status"] = "active"): RoomMemberDto => ({ userId, nickname: userId, tone: "mint", role, status, joinedAt: null });
const preview: DeactivatePreview = {
  today: "2026-10-12",
  tasks: [
    { nodeId: "5", title: "배열", roundLabel: "1주차", currentAssignees: [{ userId: "u3", nickname: "u3", tone: "mint" }] },
    { nodeId: "6", title: "스택", roundLabel: "2주차", currentAssignees: [] },
  ],
};

describe("내보내기 — 담당 과제 재배정 결정", () => {
  it("reassignCandidates: 내보낼 사람을 뺀 참가 중 팀원, 그룹장은 과제를 할 때만", () => {
    const members = [m("lead", "leader"), m("u2", "member"), m("u3", "member"), m("u4", "member", "inactive"), m("u5", "member", "pending")];
    expect(reassignCandidates(members, "u2", false).map((p) => p.userId)).toEqual(["u3"]);
    expect(reassignCandidates(members, "u2", true).map((p) => p.userId)).toEqual(["lead", "u3"]);
  });
  it("initialChoices: 다른 담당자가 있으면 '담당에서 빼기', 없으면 고르게 비워 둔다", () => {
    expect(initialChoices(preview)).toEqual({ "5": "exclude", "6": "" });
    expect(missingChoices(preview, initialChoices(preview))).toEqual(["6"]);
    expect(missingChoices(preview, { "5": "exclude", "6": "u3" })).toEqual([]);
  });
  // 0027: 넘길 사람이 없으면 "담당 미정으로 두기"(unassign)를 기본으로 — 내보내기가 막히지 않는다
  it("initialChoices(candidates): 혼자 맡았는데 맡길 사람이 없으면 unassign", () => {
    expect(initialChoices(preview, () => [])).toEqual({ "5": "exclude", "6": "unassign" });
    expect(initialChoices(preview, () => [{ userId: "u4", nickname: "u4", tone: "mint" }])).toEqual({ "5": "exclude", "6": "" });
  });
  it("decisionsOf: unassign 은 assigneeIds 없이", () => {
    expect(decisionsOf(preview, { "5": "exclude", "6": "unassign" })).toEqual([
      { nodeId: "5", action: "exclude" },
      { nodeId: "6", action: "unassign" },
    ]);
  });
  it("decisionsOf: exclude 그대로, 사람을 고르면 reassign", () => {
    expect(decisionsOf(preview, { "5": "exclude", "6": "u3" })).toEqual([
      { nodeId: "5", action: "exclude" },
      { nodeId: "6", action: "reassign", assigneeIds: ["u3"] },
    ]);
  });
});
