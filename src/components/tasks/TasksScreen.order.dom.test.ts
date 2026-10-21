// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { MeTaskItem, MeTasks } from "@/lib/api/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const nav = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.query), useRouter: () => ({ push: () => {} }), usePathname: () => "/tasks" }));
vi.mock("@/components/ui/AppHeader", () => ({ AppHeader: () => null }));
vi.mock("@/components/ui/NotificationBell", () => ({ NotificationBell: () => null }));

const { TasksScreen } = await import("./TasksScreen");

const item = (o: Partial<MeTaskItem> & { id: string }): MeTaskItem => ({
  slug: "aws", roundId: "a3", groupTitle: null, title: o.id, type: "common", startDate: "2026-10-15", endDate: "2026-10-21", st: "open", submittedAt: null, ...o,
});
/** 진행목표 트리(aws 3주차): 묶음 B [L0 완료, L1] · 리프 T · 내 개인 P1 · P2. 서버 items 순서는 마감일 순 */
const data: MeTasks = {
  today: "2026-10-16",
  personalPerRound: 20,
  studies: [{ slug: "aws", title: "AWS", tone: "mint", status: "active", membership: "joined", currentRoundId: "a3", canAddPersonal: true }],
  rounds: [{ id: "a3", slug: "aws", label: "3주차", title: "r3", startDate: "2026-10-15", endDate: "2026-10-21", canAdd: true }],
  items: [
    item({ id: "P2", type: "personal", endDate: "2026-10-16", ord: [[3, 15]] }),
    item({ id: "T", endDate: "2026-10-16", ord: [[1, 13]] }),
    item({ id: "P1", type: "personal", endDate: "2026-10-18", ord: [[2, 14]] }),
    item({ id: "L1", groupTitle: "B", endDate: "2026-10-20", ord: [[0, 10], [1, 12]] }),
    item({ id: "L0", groupTitle: "B", endDate: "2026-10-21", st: "done", ord: [[0, 10], [0, 11]] }),
  ],
};

const render = async (query: string) => {
  nav.query = query;
  const host = document.body.appendChild(document.createElement("div"));
  await act(async () => createRoot(host).render(createElement(TasksScreen, { initial: data })));
  return host;
};
/** 화면에 보이는 과제 제목 순서 */
const order = (host: HTMLElement) => {
  const titles = new Set(data.items.map((i) => i.title));
  return Array.from(host.querySelectorAll("li a, li span, li p")).map((e) => e.textContent?.trim() ?? "").filter((t, i, a) => titles.has(t) && a.indexOf(t) === i);
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TasksScreen 순서 = 진행목표 순서 (0042 ord)", () => {
  it("회차별: 묶음 깊이 우선 → 팀 → 내 개인 목표", async () => {
    expect(order(await render(""))).toEqual(["L0", "L1", "T", "P1", "P2"]);
  });
  it("마감일 묶기: 구간 → 마감일 → 진행목표 순서", async () => {
    expect(order(await render("group=due"))).toEqual(["T", "P2", "P1", "L1", "L0"]);
  });
});
