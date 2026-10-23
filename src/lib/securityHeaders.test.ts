import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { securityHeaders, supabaseOrigin } from "./securityHeaders";

const csp = (url: string | undefined) => securityHeaders(url).find((h) => h.key === "Content-Security-Policy")?.value;

describe("securityHeaders (md-images D17)", () => {
  it("로컬 Supabase — 경로·끝 슬래시는 빼고 출처만", () => expect(csp("http://127.0.0.1:54321/")).toBe("img-src 'self' data: blob: http://127.0.0.1:54321"));
  it("호스티드 Supabase", () => expect(csp("https://abc.supabase.co")).toBe("img-src 'self' data: blob: https://abc.supabase.co"));
  it("없거나 잘못된 값이면 출처 없이", () => {
    expect(csp(undefined)).toBe("img-src 'self' data: blob:");
    expect(csp("not a url")).toBe("img-src 'self' data: blob:");
    expect(supabaseOrigin("javascript:alert(1)")).toBeNull();
  });
  it("nosniff 는 늘", () => expect(securityHeaders(undefined)).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" }));
  it("img-src 외 지시어는 넣지 않는다(스크립트·스타일·연결은 그대로)", () => expect(csp("https://abc.supabase.co")).not.toMatch(/script-src|default-src|connect-src|;/));
  it("next.config 가 모든 경로에 단다", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: securityHeaders(process.env.NEXT_PUBLIC_SUPABASE_URL) }]);
  });
});
