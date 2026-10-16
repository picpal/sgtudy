import { beforeEach, describe, expect, it, vi } from "vitest";

// /tasks 서버 페이지: 로그인 가드(requireMe("/tasks")) 뒤에 me_tasks 초기값을 화면에 넘긴다
const m = vi.hoisted(() => ({ guard: [] as string[], redirectTo: null as string | null, fetched: 0 }));
vi.mock("@/lib/api/me.server", () => ({
  getServerClient: async () => ({ tag: "server" }),
  requireMe: async (returnTo: string) => {
    m.guard.push(returnTo);
    if (m.redirectTo) throw Object.assign(new Error("NEXT_REDIRECT"), { to: m.redirectTo });
    return { id: "u1" };
  },
}));
vi.mock("@/lib/api/personal", () => ({
  fetchMyTasks: async (client: unknown) => {
    m.fetched += 1;
    return { today: "2026-10-16", personalPerRound: 20, studies: [], rounds: [], items: [], client };
  },
}));
vi.mock("@/components/tasks/TasksScreen", () => ({ TasksScreen: () => null }));

const { default: TasksPage, metadata } = await import("./page");

describe("/tasks page", () => {
  beforeEach(() => {
    m.guard = [];
    m.redirectTo = null;
    m.fetched = 0;
  });
  it("title", () => {
    expect(metadata.title).toBe("슥터디 내 과제");
  });
  it("guards with requireMe(/tasks) and passes me_tasks (server client) as initial", async () => {
    const el = (await TasksPage()) as { props: { initial: { today: string; client: unknown } } };
    expect(m.guard).toEqual(["/tasks"]);
    expect(m.fetched).toBe(1);
    expect(el.props.initial).toMatchObject({ today: "2026-10-16", client: { tag: "server" } });
  });
  it("redirect from the guard wins over the data fetch", async () => {
    m.redirectTo = "/login?returnTo=%2Ftasks";
    await expect(TasksPage()).rejects.toMatchObject({ to: "/login?returnTo=%2Ftasks" });
  });
});
