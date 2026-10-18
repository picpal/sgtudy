// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { RoomMemberDto } from "@/lib/api/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const api = vi.hoisted(() => ({ fetchLeaveRequests: vi.fn(), dismissLeaveRequest: vi.fn(), previewDeactivate: vi.fn(), deactivateMember: vi.fn() }));
vi.mock("@/lib/api/leave", async (orig) => ({ ...(await orig<typeof import("@/lib/api/leave")>()), ...api }));

const { LeaveAdmin } = await import("./LeaveAdmin");

const M = (userId: string, nickname: string, role: "leader" | "member" = "member"): RoomMemberDto => ({ userId, nickname, tone: "mint", role, status: "active", joinedAt: null });
const members = [M("lead", "하준", "leader"), M("u3", "윤호"), M("u4", "은지쌤")];
const req = { userId: "u3", nickname: "윤호", tone: "mint", requestedAt: "2026-10-12T01:00:00.000Z", reason: "이사 가요", pendingTaskCount: 1 };
const flush = () => act(async () => {});
const dbtn = (text: string) => Array.from(document.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const btn = (text: string) => Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text);

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

async function mount(count = 1) {
  const toast = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(LeaveAdmin, { slug: "r1", today: "2026-10-12", members, leaderDoesTasks: false, leaveRequestCount: count, toast })));
  await flush();
  return { host, root, toast };
}

// 시나리오 QA D3: 그룹장 — 탈퇴 요청 목록(#leave-requests)에서 내보내기 또는 반려, 그 밖의 팀원도 내보내기
describe("LeaveAdmin — 탈퇴 요청", () => {
  it("요청 목록: 이름·요청 날짜·미제출 지정 과제 수·사유", async () => {
    api.fetchLeaveRequests.mockResolvedValue({ today: "2026-10-12", items: [req] });
    const { host, root } = await mount();
    expect(api.fetchLeaveRequests).toHaveBeenCalledWith("r1");
    const box = host.querySelector("#leave-requests")!;
    expect(box.textContent).toContain("탈퇴 요청");
    // 딥링크로 포커스가 오면 무엇인지 읽힌다 (최종 리뷰 Minor 5)
    expect(host.querySelector(`#${CSS.escape(box.getAttribute("aria-labelledby") ?? "x")}`)?.textContent).toBe("탈퇴 요청");
    const row = box.querySelector('[data-leave-row="u3"]')!;
    expect(row.textContent).toContain("윤호");
    expect(row.textContent).toContain("10.12 요청 · 미제출 지정 과제 1개");
    expect(row.textContent).toContain("이사 가요");
    act(() => root.unmount());
  });

  it("반려: 확인 뒤 member_leave_request_dismiss, 목록을 서버 값으로", async () => {
    api.fetchLeaveRequests.mockResolvedValue({ today: "2026-10-12", items: [req] });
    api.dismissLeaveRequest.mockResolvedValue({ today: "2026-10-12", items: [] });
    const { host, root, toast } = await mount();
    act(() => btn("윤호 탈퇴 요청 반려")!.click());
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("윤호 님의 탈퇴 요청을 반려할까요?");
    await act(async () => dbtn("반려")!.click());
    await flush();
    expect(api.dismissLeaveRequest).toHaveBeenCalledWith("r1", "u3");
    expect(toast).toHaveBeenCalledWith({ text: "윤호 님의 탈퇴 요청을 반려했어요 · 계속 참가 중이에요", tone: "ok" });
    expect(host.querySelector('[data-leave-row="u3"]')).toBeNull();
    act(() => root.unmount());
  });

  it("내보내기: 미리보기 → 혼자 맡은 과제는 맡길 사람을 골라야 실행 → member_deactivate", async () => {
    api.fetchLeaveRequests.mockResolvedValue({ today: "2026-10-12", items: [req] });
    api.previewDeactivate.mockResolvedValue({ today: "2026-10-12", tasks: [{ nodeId: "9", title: "배열 문제", roundLabel: "1주차", currentAssignees: [] }] });
    api.deactivateMember.mockResolvedValue({ me: { state: "leader" }, memberCount: 2, members, pendingCount: 0 });
    const { root, toast } = await mount();
    await act(async () => btn("윤호 내보내기")!.click());
    await flush();
    expect(api.previewDeactivate).toHaveBeenCalledWith("r1", "u3");
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("윤호 님을 내보낼까요?");
    expect(dialog.textContent).toContain("제출 기록은 남아요");
    expect(dialog.textContent).toContain("1주차 · 배열 문제");
    const run = dbtn("내보내기")!;
    expect(run.disabled).toBe(true); // 아직 안 고름
    const sel = dialog.querySelector<HTMLSelectElement>("select")!;
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(["맡길 사람 고르기", "담당 미정으로 두기", "은지쌤 님에게 맡기기"]);
    act(() => {
      sel.value = "u4";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(dbtn("내보내기")!.disabled).toBe(false);
    await act(async () => dbtn("내보내기")!.click());
    await flush();
    expect(api.deactivateMember).toHaveBeenCalledWith("r1", "u3", [{ nodeId: "9", action: "reassign", assigneeIds: ["u4"] }]);
    expect(toast).toHaveBeenCalledWith({ text: "윤호 님을 내보냈어요 · 맡은 과제 1개를 정리했어요", tone: "ok" });
    expect(refresh).toHaveBeenCalled();
    act(() => root.unmount());
  });

  // 0027: 맡길 팀원이 없으면 "담당 미정으로 두기" 가 기본 — 바로 내보낼 수 있고, 토스트에 담당 미정 수
  it("맡길 사람이 없으면 담당 미정으로 두기가 기본이고 실행된다", async () => {
    api.fetchLeaveRequests.mockResolvedValue({ today: "2026-10-12", items: [req] });
    api.previewDeactivate.mockResolvedValue({ today: "2026-10-12", tasks: [{ nodeId: "9", title: "배열 문제", roundLabel: "1주차", currentAssignees: [] }] });
    api.deactivateMember.mockResolvedValue({ me: { state: "leader" }, memberCount: 1, members, pendingCount: 0 });
    const toast = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(LeaveAdmin, { slug: "r1", today: "2026-10-12", members: [M("lead", "하준", "leader"), M("u3", "윤호")], leaderDoesTasks: false, leaveRequestCount: 1, toast })));
    await flush();
    await act(async () => btn("윤호 내보내기")!.click());
    await flush();
    const sel = document.querySelector<HTMLSelectElement>('[role="alertdialog"] select')!;
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(["담당 미정으로 두기"]);
    expect(sel.value).toBe("unassign");
    expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain("담당 미정으로 남아요 · 내보낸 뒤 진행목표에서 담당자를 정해 주세요");
    expect(document.querySelector('[role="alertdialog"]')!.textContent).not.toContain("맡길 수 있는 팀원이 없어요");
    expect(dbtn("내보내기")!.disabled).toBe(false);
    await act(async () => dbtn("내보내기")!.click());
    await flush();
    expect(api.deactivateMember).toHaveBeenCalledWith("r1", "u3", [{ nodeId: "9", action: "unassign" }]);
    expect(toast).toHaveBeenCalledWith({ text: "윤호 님을 내보냈어요 · 맡은 과제 1개를 정리했어요 · 담당 미정 1개", tone: "ok" });
    act(() => root.unmount());
  });

  // 재리뷰 Minor B: 이미 처리된 요청 알림(#leave-requests, 0건)으로 들어와도 빈 목록이 남아 포커스가 body 로 가지 않는다
  it("해시로 들어오면 0건이어도 빈 목록이 남고 포커스를 지킨다", async () => {
    Element.prototype.scrollIntoView = () => {};
    window.history.replaceState(null, "", "/my-study/r1#leave-requests");
    const { host, root } = await mount(0);
    await flush();
    const box = host.querySelector("#leave-requests");
    expect(box).not.toBeNull();
    expect(box!.textContent).toContain("지금 처리할 탈퇴 요청이 없어요");
    expect(document.activeElement?.id).toBe("leave-requests");
    act(() => root.unmount());
    window.history.replaceState(null, "", "/");
  });

  it("요청이 없어도 [팀원 내보내기] → 팀원 고르기 → 미제출 과제 없으면 바로", async () => {
    api.previewDeactivate.mockResolvedValue({ today: "2026-10-12", tasks: [] });
    api.deactivateMember.mockResolvedValue({ me: { state: "leader" }, memberCount: 2, members, pendingCount: 0 });
    const { host, root, toast } = await mount(0);
    expect(api.fetchLeaveRequests).not.toHaveBeenCalled();
    expect(host.querySelector("#leave-requests")).toBeNull();
    act(() => btn("팀원 내보내기")!.click());
    const radios = document.querySelectorAll<HTMLInputElement>('[role="alertdialog"] input[type="radio"]');
    expect(Array.from(radios).map((r) => r.closest("label")?.textContent)).toEqual(["윤호", "은지쌤"]);
    act(() => radios[1].click());
    await act(async () => btn("다음")!.click());
    await flush();
    expect(api.previewDeactivate).toHaveBeenCalledWith("r1", "u4");
    expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain("미제출 지정 과제가 없어요");
    await act(async () => dbtn("내보내기")!.click());
    await flush();
    expect(api.deactivateMember).toHaveBeenCalledWith("r1", "u4", []);
    expect(toast).toHaveBeenCalledWith({ text: "은지쌤 님을 내보냈어요", tone: "ok" });
    act(() => root.unmount());
  });
});
