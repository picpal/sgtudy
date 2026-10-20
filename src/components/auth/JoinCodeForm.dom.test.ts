// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/lib/api/recruit", async (orig) => ({ ...(await orig<typeof import("@/lib/api/recruit")>()), lookupInviteCode: vi.fn() }));

const { JoinCodeForm } = await import("./JoinCodeForm");

const render = (initial: string) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(JoinCodeForm, { initial }));
  return root;
};

describe("JoinCodeForm", () => {
  it("fills the input from ?code= in display form", () => {
    const input = render("k7qm3xpa").querySelector("input")!;
    expect(input.getAttribute("value")).toBe("K7QM-3XPA");
    expect(input.getAttribute("aria-label")).toBe("초대 코드");
    expect(input.className).toContain("font-mono");
  });
  it("has the 다음 button", () => {
    expect(render("").querySelector("button")?.textContent).toBe("다음");
  });
});
