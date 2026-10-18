// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReasonField } from "./ReasonField";

// 최종 리뷰 Minor 3: 글자 수는 키를 누를 때마다 읽히지 않게 — 한도는 입력칸 설명으로 한 번
describe("ReasonField", () => {
  it("카운터는 live 영역이 아니고, 입력칸 설명에 한도", () => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(createElement(ReasonField, { value: "abc", onChange: () => {}, label: "사유 (선택)" }));
    expect(root.querySelector("[aria-live]")).toBeNull();
    const ta = root.querySelector("textarea")!;
    expect(root.querySelector(`#${CSS.escape(ta.getAttribute("aria-describedby") ?? "x")}`)?.textContent).toBe("200자까지 · 지금 3자");
  });
});
