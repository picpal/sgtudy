// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TreeRow } from "./TreeRow";
import { InlineConfirm } from "./InlineConfirm";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { AWS, REF_DAY } from "../fixtures";

// 목록 삭제 확인 상자는 행의 treeitem 안에 — role="tree" 가 treeitem 아닌 것을 직접 소유하지 않게 (a11y required-owned)
describe("TreeRow below (list delete confirm)", () => {
  const n = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY).roots[0];
  const render = (below?: React.ReactNode) => {
    const html = renderToStaticMarkup(
      createElement("div", { role: "tree" }, createElement("div", null, createElement(TreeRow, { n, isEdit: true, open: true, onToggle: () => {}, onClick: () => {}, onRemove: () => {}, asking: !!below, below }))),
    );
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
  };

  it("renders the open confirm inside the row's treeitem, after the 52px row", () => {
    const doc = render(createElement(InlineConfirm, { text: "삭제할까요?", onCancel: () => {}, actions: [{ label: "삭제", onClick: () => {}, tone: "danger" }] }));
    const item = doc.querySelector('[role="treeitem"]')!;
    const dialog = doc.querySelector('[role="alertdialog"]')!;
    expect(dialog.closest('[role="treeitem"]')).toBe(item);
    // 트리의 소유 요소(일반 div 를 건너뛴)는 treeitem 하나뿐
    const tree = doc.querySelector('[role="tree"]')!;
    const owned = Array.from(tree.querySelectorAll("[role]")).filter((el) => el.parentElement?.closest("[role]") === tree);
    expect(owned.map((el) => el.getAttribute("role"))).toEqual(["treeitem"]);
    // 보이는 행(52px)과 확인 상자는 treeitem 의 형제 자식 — 삭제 버튼은 행 안, 확인 버튼은 Tab 으로 닿는 button
    const [row, box] = Array.from(item.children);
    expect(row.className).toContain("min-h-[52px]");
    expect(row.querySelector("[data-row-del]")?.getAttribute("aria-expanded")).toBe("true");
    expect(box.contains(dialog)).toBe(true);
    expect(Array.from(dialog.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["취소", "삭제"]);
  });

  it("renders only the row when no confirm is open", () => {
    const item = render().querySelector('[role="treeitem"]')!;
    expect(item.children).toHaveLength(1);
  });
});
