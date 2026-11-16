// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({ IBM_Plex_Sans_KR: () => ({ variable: "font-plex" }) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {}, useRouter: () => ({}), usePathname: () => "/" }));
vi.mock("@/lib/api/me.server", () => ({
  getAuthClaims: async () => null,
  getMe: async () => null,
  getMyStudies: async () => [],
  getToday: async () => "2026-11-16",
  isOrphanSession: () => false,
}));
vi.mock("./globals.css", () => ({}));

const { default: RootLayout } = await import("./layout");

describe("루트 레이아웃 — iOS 상태바 띠 덮개", () => {
  it("덮개는 페이지마다 한 번, body 바로 아래에 화면 위(top:-64px) 고정으로 그려지고 누를 수 없다", async () => {
    const el = await RootLayout({ children: createElement("main", null, "본문"), params: Promise.resolve({}) });
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(el), "text/html");
    const plates = doc.querySelectorAll("[data-band-plate]");
    expect(plates).toHaveLength(1);
    const plate = plates[0];
    expect(plate.parentElement?.tagName).toBe("BODY");
    expect(plate.getAttribute("aria-hidden")).toBe("true");
    expect(plate.className.split(" ")).toEqual(expect.arrayContaining(["pointer-events-none", "fixed", "inset-x-0", "top-[-64px]", "h-16"]));
  });
});
