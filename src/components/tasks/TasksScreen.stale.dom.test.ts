// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { MeTasks } from "@/lib/api/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: () => {} }), usePathname: () => "/tasks" }));
vi.mock("@/components/ui/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/components/ui/NotificationBell", () => ({ NotificationBell: () => null }));
const m = vi.hoisted(() => ({ fetchMyTasks: vi.fn() }));
vi.mock("@/lib/api/personal", async (orig) => ({ ...(await orig<object>()), fetchMyTasks: m.fetchMyTasks }));

const { TasksScreen } = await import("./TasksScreen");
const { bumpProgress } = await import("@/lib/progressStale");

const data = (st: "open" | "done"): MeTasks => ({
  today: "2026-10-16",
  personalPerRound: 20,
  studies: [{ slug: "aws", title: "AWS", tone: "mint", status: "active", membership: "joined", currentRoundId: "a3", canAddPersonal: true }],
  rounds: [{ id: "a3", slug: "aws", label: "3주차", title: "r3", startDate: "2026-10-15", endDate: "2026-10-21", canAdd: true }],
  items: [{ id: "T", slug: "aws", roundId: "a3", groupTitle: null, title: "ALB 실습", type: "common", startDate: "2026-10-15", endDate: "2026-10-21", st, submittedAt: st === "done" ? "2026-10-16T01:00:00Z" : null }],
});
const mount = async (initial: MeTasks) => {
  const host = document.body.appendChild(document.createElement("div"));
  await act(async () => createRoot(host).render(createElement(TasksScreen, { initial })));
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  return host;
};
afterEach(() => {
  document.body.innerHTML = "";
  m.fetchMyTasks.mockReset();
});

describe("TasksScreen — 뒤로 가기로 되살아난 옛 목록", () => {
  it("다른 화면에서 제출한 뒤 다시 마운트되면 한 번 다시 받는다(옛 props 대신 새 상태)", async () => {
    const first = await mount(data("open")); // 첫 마운트 — 다시 받지 않는다
    expect(m.fetchMyTasks).not.toHaveBeenCalled();
    expect(first.textContent).toContain("0/1");
    bumpProgress(); // 진행목표에서 제출
    m.fetchMyTasks.mockResolvedValue(data("done"));
    document.body.innerHTML = "";
    const host = await mount(data("open")); // 클라이언트 캐시의 옛 props
    expect(m.fetchMyTasks).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("1/1");
  });
});
