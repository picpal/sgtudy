import { beforeEach, describe, expect, it, vi } from "vitest";

// /login: 로그인 상태면 returnTo 로 — 단 고아 세션이면 dest ↔ /login 을 오가지 않게 정리 라우트로. reason=session_expired 면 안내
const m = vi.hoisted(() => ({ claims: null as null | object, orphan: false }));
vi.mock("@/lib/api/me.server", () => ({
  getAuthClaims: async () => m.claims,
  getMeOrExpire: async (returnTo: string) => {
    if (m.orphan) throw Object.assign(new Error("NEXT_REDIRECT"), { to: `/auth/session-expired?returnTo=${encodeURIComponent(returnTo)}` });
    return { id: "u1", onboarded: true };
  },
}));
vi.mock("@/components/auth/LoginScreen", () => ({ LoginScreen: () => null }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

const { default: LoginPage } = await import("./page");

const render = async (q: { returnTo?: string; reason?: string }) => {
  try {
    return { props: ((await LoginPage({ searchParams: Promise.resolve(q) })) as { props: Record<string, unknown> }).props };
  } catch (e) {
    return { redirect: (e as { to?: string }).to };
  }
};

describe("/login page", () => {
  beforeEach(() => {
    m.claims = null;
    m.orphan = false;
  });
  it("shows the session-expired notice only for reason=session_expired", async () => {
    expect((await render({ returnTo: "/rooms/new", reason: "session_expired" })).props).toEqual({ returnTo: "/rooms/new", sessionExpired: true });
    expect((await render({ returnTo: "/rooms/new", reason: "other" })).props).toMatchObject({ sessionExpired: false });
    expect((await render({})).props).toMatchObject({ returnTo: "/", sessionExpired: false });
  });
  it("logged in → returnTo", async () => {
    m.claims = { sub: "u1" };
    expect(await render({ returnTo: "/my-study" })).toEqual({ redirect: "/my-study" });
  });
  it("orphan session → cleanup route instead of bouncing to returnTo", async () => {
    m.claims = { sub: "u1" };
    m.orphan = true;
    expect(await render({ returnTo: "/rooms/new" })).toEqual({ redirect: "/auth/session-expired?returnTo=%2Frooms%2Fnew" });
  });
});
