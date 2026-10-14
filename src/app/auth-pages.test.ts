import { beforeEach, describe, expect, it, vi } from "vitest";

// /signup·/reset-password 서버 페이지: returnTo 는 safeReturnTo 를 거쳐 흐름에 넘어가고,
// 로그인 사용자는 비밀번호가 있으면 returnTo 로, 없으면 비밀번호 단계(resume)로 간다(리뷰 Minor 2·9)
const auth = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock("@/lib/api/me.server", () => ({ getAuthUser: async () => auth.user }));
vi.mock("@/components/auth/OtpPasswordFlow", () => ({ OtpPasswordFlow: () => null }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));

const { default: SignupPage } = await import("./signup/page");
const { default: ResetPasswordPage } = await import("./reset-password/page");

type Page = (p: { searchParams: Promise<{ returnTo?: string | string[] }> }) => Promise<unknown>;
const render = async (page: Page, returnTo?: string | string[]) => {
  try {
    const el = (await page({ searchParams: Promise.resolve({ returnTo }) })) as { props: Record<string, unknown> };
    return { props: el.props };
  } catch (e) {
    return { redirect: (e as { to?: string }).to };
  }
};

const pages: [string, Page, "signup" | "reset"][] = [
  ["/signup", SignupPage as Page, "signup"],
  ["/reset-password", ResetPasswordPage as Page, "reset"],
];

describe.each(pages)("%s page", (_, page, mode) => {
  beforeEach(() => {
    auth.user = null;
  });
  it("passes only a safe returnTo to the flow", async () => {
    expect((await render(page, "//evil.com")).props).toMatchObject({ mode, returnTo: "/" });
    expect((await render(page, "https://evil.com")).props).toMatchObject({ returnTo: "/" });
    expect((await render(page, ["/rooms/a", "/rooms/b"])).props).toMatchObject({ returnTo: "/" });
    const ok = (await render(page, "/rooms/aws")).props;
    expect(ok).toMatchObject({ returnTo: "/rooms/aws" });
    expect(ok?.resume).toBeUndefined();
  });
  it("logged in with a password → redirect to the safe returnTo", async () => {
    auth.user = { email: "a@b.c", created_at: "2025-01-01T00:00:00Z", user_metadata: { has_password: true } };
    expect(await render(page, "/rooms/aws")).toEqual({ redirect: "/rooms/aws" });
    expect(await render(page, "//evil.com")).toEqual({ redirect: "/" });
  });
  it("logged in without a password → back to the password step", async () => {
    auth.user = { email: "a@b.c", created_at: "2025-01-01T00:00:00Z", user_metadata: {} };
    const r = await render(page, "/schedule");
    expect(r.props).toMatchObject({ mode, returnTo: "/schedule", resume: { email: "a@b.c", verified: mode === "reset" ? "reset" : "existing" } });
  });
});
