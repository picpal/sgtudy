// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { DATE_NO_OVERFLOW_CLASS } from "@/components/room-new/fields";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { EndDateForm } = await import("./EndDateForm");

afterEach(() => {
  document.body.innerHTML = "";
});

describe("EndDateForm 날짜 칸", () => {
  it("iOS 넘침 방지 클래스를 갖고, 기존 높이(h-11)는 유지", () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    act(() => root.render(createElement(EndDateForm, { slug: "r1", initial: "2026-12-01", onSaved: () => {}, onCancel: () => {} })));
    const input = host.querySelector('input[type="date"]')!;
    expect(input.className.split(/\s+/)).toEqual(expect.arrayContaining(DATE_NO_OVERFLOW_CLASS.split(/\s+/)));
    expect(input.classList.contains("h-11")).toBe(true);
  });
});
