import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// 가드는 getClaims()(JWT 검증, 비대칭키면 Auth 왕복 없음)로 판정한다 — getUser() 를 부르면 실패하게 둔다
const auth = vi.hoisted(() => ({
  claims: null as null | { sub: string },
  refreshed: null as null | { name: string; value: string }[],
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: (c: { name: string; value: string; options: object }[]) => void } }) => ({
    auth: {
      getClaims: async () => {
        if (auth.refreshed) opts.cookies.setAll(auth.refreshed.map((c) => ({ ...c, options: { path: "/" } })));
        return { data: auth.claims ? { claims: auth.claims, header: {}, signature: new Uint8Array() } : null, error: null };
      },
      getUser: async () => {
        throw new Error("getUser must not be called by the proxy guard");
      },
    },
  }),
}));

const { updateSession } = await import("./middleware");

describe("updateSession without Supabase env (I2)", () => {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });
  afterEach(() => {
    if (saved.url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.key;
  });

  it("passes the request through as unauthenticated instead of throwing", async () => {
    const res = await updateSession(new NextRequest("http://localhost:3000/my-study"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("updateSession guard via getClaims", () => {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    auth.claims = null;
    auth.refreshed = null;
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.key;
    if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (saved.key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("redirects an anonymous visitor of a protected route to /login with returnTo (path + query)", async () => {
    const res = await updateSession(new NextRequest("http://localhost:3000/my-study/aws?tab=gantt"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?returnTo=%2Fmy-study%2Faws%3Ftab%3Dgantt");
  });

  it("lets an anonymous visitor through public routes", async () => {
    const res = await updateSession(new NextRequest("http://localhost:3000/rooms/aws"));
    expect(res.status).toBe(200);
  });

  it("lets a signed-in user through protected routes", async () => {
    auth.claims = { sub: "u1" };
    const res = await updateSession(new NextRequest("http://localhost:3000/schedule"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("keeps refreshed session cookies on the response", async () => {
    auth.claims = { sub: "u1" };
    auth.refreshed = [{ name: "sb-test-auth-token", value: "fresh" }];
    const res = await updateSession(new NextRequest("http://localhost:3000/me"));
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("fresh");
  });
});
