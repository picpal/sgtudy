import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiException } from "@/lib/api/errors";

// 고아 세션(계정 삭제 후 남은 쿠키): me_get NOT_FOUND → 에러 화면 대신 세션 정리 라우트로 보낸다
vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
const m = vi.hoisted(() => ({ claims: null as null | { sub: string }, rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: m.claims ? { claims: m.claims } : null }) }, rpc: m.rpc }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

const { getMeOrExpire, isOrphanSession, requireMe } = await import("./me.server");

const fail = (code: string) => ({ data: null, error: { message: code, details: "문구", hint: "{}", code: "P0001" } });
const me = (onboarded: boolean) => ({ data: { id: "u1", onboarded }, error: null });
const run = async (p: Promise<unknown>) => {
  try {
    return { value: await p };
  } catch (e) {
    return (e as { to?: string }).to ? { redirect: (e as { to: string }).to } : { error: e };
  }
};

describe("isOrphanSession", () => {
  it("only me_get NOT_FOUND counts", () => {
    expect(isOrphanSession(new ApiException({ code: "NOT_FOUND", message: "프로필이 없어요" }))).toBe(true);
    expect(isOrphanSession(new ApiException({ code: "AUTH_REQUIRED", message: "x" }))).toBe(false);
    expect(isOrphanSession(new Error("NOT_FOUND"))).toBe(false);
  });
});

describe("getMeOrExpire / requireMe", () => {
  beforeEach(() => {
    m.claims = { sub: "u1" };
    m.rpc.mockReset();
  });
  it("orphan session → session-expired route with returnTo", async () => {
    m.rpc.mockResolvedValue(fail("NOT_FOUND"));
    expect(await run(requireMe("/rooms/new"))).toEqual({ redirect: "/auth/session-expired?returnTo=%2Frooms%2Fnew" });
    expect(await run(getMeOrExpire("/my-study"))).toEqual({ redirect: "/auth/session-expired?returnTo=%2Fmy-study" });
  });
  it("other failures still throw (error screen)", async () => {
    m.rpc.mockResolvedValue(fail("INTERNAL"));
    const r = await run(requireMe("/tasks"));
    expect(r.error).toBeInstanceOf(ApiException);
    expect((r.error as ApiException).code).toBe("INTERNAL");
  });
  it("no session → login, not onboarded → onboarding, ok → me", async () => {
    m.claims = null;
    expect(await run(requireMe("/tasks"))).toEqual({ redirect: "/login?returnTo=%2Ftasks" });
    expect(m.rpc).not.toHaveBeenCalled();
    m.claims = { sub: "u1" };
    m.rpc.mockResolvedValue(me(false));
    expect(await run(requireMe("/tasks"))).toEqual({ redirect: "/onboarding?returnTo=%2Ftasks" });
    m.rpc.mockResolvedValue(me(true));
    expect(await run(requireMe("/tasks"))).toEqual({ value: { id: "u1", onboarded: true } });
  });
});
