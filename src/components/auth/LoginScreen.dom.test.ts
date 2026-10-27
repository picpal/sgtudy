// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LoginReason } from "@/lib/supabase/return-to";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {} }) }));
const { LoginScreen } = await import("./LoginScreen");

const render = (reason?: LoginReason | null) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(LoginScreen, { returnTo: "/my-study", reason }));
  return root;
};

describe("LoginScreen reason notice", () => {
  it("session_inactive → 오랫동안 사용하지 않아 로그아웃 안내(role=status)", () => {
    expect(render("session_inactive").querySelector('[role="status"]')?.textContent).toBe(
      "오랫동안 사용하지 않아 로그아웃됐어요. 다시 로그인해 주세요.",
    );
  });
  it("session_expired → 기존 만료 안내 그대로", () => {
    expect(render("session_expired").querySelector('[role="status"]')?.textContent).toBe("로그인 정보가 만료됐어요. 다시 로그인해 주세요.");
  });
  it("no reason → 안내 없음", () => {
    expect(render(null).querySelector('[role="status"]')).toBeNull();
    expect(render().querySelector('[role="status"]')).toBeNull();
  });
});
