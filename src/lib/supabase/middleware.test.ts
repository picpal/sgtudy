import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// 가드는 getClaims()(JWT 검증, 비대칭키면 Auth 왕복 없음)로 판정한다 — getUser() 를 부르면 실패하게 둔다
const auth = vi.hoisted(() => ({
  claims: null as null | { sub: string },
  refreshed: null as null | { name: string; value: string }[],
  error: null as null | { code?: string; name?: string },
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: { setAll: (c: { name: string; value: string; options: object }[]) => void } }) => ({
    auth: {
      getClaims: async () => {
        if (auth.refreshed) opts.cookies.setAll(auth.refreshed.map((c) => ({ ...c, options: { path: "/" } })));
        return { data: auth.claims ? { claims: auth.claims, header: {}, signature: new Uint8Array() } : null, error: auth.error };
      },
      getUser: async () => {
        throw new Error("getUser must not be called by the proxy guard");
      },
    },
  }),
}));

const { updateSession, isInactiveLogout } = await import("./middleware");
const { safeReturnTo } = await import("./return-to");

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
    auth.error = null;
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

  it("unauthenticated /join?code=… → /login?returnTo keeps the code, and the login page's safeReturnTo returns it intact", async () => {
    auth.claims = null;
    const res = await updateSession(new NextRequest("http://localhost:3000/join?code=k7qm-3xpa"));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    const back = loc.searchParams.get("returnTo");
    expect(back).toBe("/join?code=k7qm-3xpa");
    expect(safeReturnTo(back)).toBe("/join?code=k7qm-3xpa"); // LoginScreen 이 로그인 뒤 router.push 하는 값
    expect(new URL(back!, "http://x").searchParams.get("code")).toBe("k7qm-3xpa"); // /join 페이지가 칸을 채우는 값
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

  const withCookie = (path: string, cookies: string) => new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: cookies } });

  it("session cookie + refresh rejected (refresh_token_not_found) on a protected route → /login with reason=session_inactive, cookies cleared", async () => {
    auth.error = { code: "refresh_token_not_found", name: "AuthApiError" };
    auth.refreshed = [{ name: "sb-test-auth-token", value: "" }]; // auth-js _removeSession → 쿠키 비움
    const res = await updateSession(withCookie("/my-study/aws?tab=gantt", "sb-test-auth-token=base64-abc"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?returnTo=%2Fmy-study%2Faws%3Ftab%3Dgantt&reason=session_inactive");
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("");
  });

  it("chunked session cookie (.0/.1) counts as a session", async () => {
    auth.error = { code: "session_not_found", name: "AuthApiError" };
    const res = await updateSession(withCookie("/schedule", "sb-test-auth-token.0=base64-a; sb-test-auth-token.1=b"));
    expect(new URL(res.headers.get("location")!).searchParams.get("reason")).toBe("session_inactive");
  });

  it("retryable/network refresh failure → plain /login (no inactive notice)", async () => {
    auth.error = { name: "AuthRetryableFetchError" }; // code 없음, auth-js 는 세션을 지우지 않는다
    const res = await updateSession(withCookie("/schedule", "sb-test-auth-token=base64-abc"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?returnTo=%2Fschedule");
  });

  it("no session cookie (only a code-verifier) → plain /login", async () => {
    auth.error = { code: "refresh_token_not_found" };
    const res = await updateSession(withCookie("/schedule", "sb-test-auth-token-code-verifier=x"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login?returnTo=%2Fschedule");
  });

  it("public route with a rejected session passes through (no redirect)", async () => {
    auth.error = { code: "refresh_token_not_found" };
    const res = await updateSession(withCookie("/rooms/aws", "sb-test-auth-token=base64-abc"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("isInactiveLogout", () => {
  it("only when a session cookie was sent, no claims, and the server said the session is gone", () => {
    expect(isInactiveLogout(true, undefined, { code: "refresh_token_not_found" })).toBe(true);
    expect(isInactiveLogout(true, undefined, { code: "session_not_found" })).toBe(true);
    expect(isInactiveLogout(true, undefined, { code: "session_expired" })).toBe(true);
    expect(isInactiveLogout(false, undefined, { code: "refresh_token_not_found" })).toBe(false);
    expect(isInactiveLogout(true, { sub: "u1" }, { code: "refresh_token_not_found" })).toBe(false);
    expect(isInactiveLogout(true, undefined, { name: "AuthRetryableFetchError" })).toBe(false);
    expect(isInactiveLogout(true, undefined, { code: "refresh_token_already_used" })).toBe(false);
    expect(isInactiveLogout(true, undefined, null)).toBe(false);
  });
});
