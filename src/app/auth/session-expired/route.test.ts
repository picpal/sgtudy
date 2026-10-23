import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// GET /auth/session-expired — 고아 세션일 때만 쿠키를 지우고 /login?reason=session_expired 로 (로그아웃 CSRF 방지)
vi.mock("server-only", () => ({}));
const m = vi.hoisted(() => ({
  claims: null as null | { sub: string },
  rpc: vi.fn(),
  signOut: vi.fn(),
  jar: [] as { name: string; value: string }[],
  deleted: [] as string[],
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: m.claims ? { claims: m.claims } : null }), signOut: m.signOut },
    rpc: m.rpc,
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => m.jar, delete: (name: string) => m.deleted.push(name) }),
}));

const { GET } = await import("./route");

const get = (returnTo?: string) =>
  GET(new NextRequest(`http://os.localhost:3000/auth/session-expired${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`));
const where = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { to?: string }).to;
  }
  throw new Error("expected a redirect");
};
const fail = (code: string) => ({ data: null, error: { message: code, details: "문구", hint: "{}", code: "P0001" } });

describe("GET /auth/session-expired", () => {
  beforeEach(() => {
    m.claims = { sub: "u1" };
    m.rpc.mockReset();
    m.signOut.mockReset().mockResolvedValue({ error: null });
    m.jar = [
      { name: "sb-127-auth-token.0", value: "a" },
      { name: "sb-127-auth-token.1", value: "b" },
      { name: "theme", value: "dark" },
    ];
    m.deleted = [];
  });
  it("orphan (me_get NOT_FOUND) → signOut(local) + sb-* cookies deleted → login with reason, returnTo kept", async () => {
    m.rpc.mockResolvedValue(fail("NOT_FOUND"));
    expect(await where(get("/rooms/new"))).toBe("/login?returnTo=%2Frooms%2Fnew&reason=session_expired");
    expect(m.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(m.deleted).toEqual(["sb-127-auth-token.0", "sb-127-auth-token.1"]);
  });
  it("signOut failing (Auth user already gone) still clears cookies", async () => {
    m.rpc.mockResolvedValue(fail("NOT_FOUND"));
    m.signOut.mockRejectedValue(new Error("user_not_found"));
    expect(await where(get("/my-study"))).toBe("/login?returnTo=%2Fmy-study&reason=session_expired");
    expect(m.deleted).toHaveLength(2);
  });
  it("healthy session → nothing deleted, back to returnTo", async () => {
    m.rpc.mockResolvedValue({ data: { id: "u1" }, error: null });
    expect(await where(get("/tasks"))).toBe("/tasks");
    expect(m.signOut).not.toHaveBeenCalled();
    expect(m.deleted).toEqual([]);
  });
  it("other me_get failure → nothing deleted, back to returnTo", async () => {
    m.rpc.mockResolvedValue(fail("INTERNAL"));
    expect(await where(get("/tasks"))).toBe("/tasks");
    expect(m.signOut).not.toHaveBeenCalled();
  });
  it("no session → login with reason, no DB call", async () => {
    m.claims = null;
    expect(await where(get("/schedule"))).toBe("/login?returnTo=%2Fschedule&reason=session_expired");
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.signOut).not.toHaveBeenCalled();
  });
  it("unsafe returnTo → /", async () => {
    m.rpc.mockResolvedValue(fail("NOT_FOUND"));
    expect(await where(get("//evil.com"))).toBe("/login?returnTo=%2F&reason=session_expired");
    expect(await where(get())).toBe("/login?returnTo=%2F&reason=session_expired");
  });
});
