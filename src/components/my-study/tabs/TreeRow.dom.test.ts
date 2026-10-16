// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TreeRow } from "./TreeRow";
import { InlineConfirm } from "./InlineConfirm";
import { EMPTY_OVERRIDES, buildTree, type LeafNode, type TreeNode } from "../model";
import { AWS, CHULSU, REF_DAY } from "../fixtures";

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

// 개인 목표 행 — [개인] 배지, 끌기·삭제 없음, 소유자: 내 것은 표시 없음(결정 5) · 남의 것은 아바타 20px + 이름
describe("TreeRow personal goal row", () => {
  const t = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
  const node = (id: string) => t.nodes.find((n) => n.id === id)!;
  const render = (id: string, isEdit = false) => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(createElement(TreeRow, { n: node(id), isEdit, open: true, meId: CHULSU, onToggle: () => {}, onClick: () => {}, onRemove: () => {}, dragHandle: { onPointerDown: () => {} } }));
    return root;
  };

  it("shows the [개인] badge and the owner's status (개인 완료 문구)", () => {
    const mine = render("32");
    expect(mine.querySelector("[data-row-main]")!.textContent).toContain("개인");
    expect(mine.querySelector("[data-personal-status]")!.textContent).toBe("예정");
    // 지은 것(완료) — 팀의 "기한내 제출" 대신 "기한내 완료"
    expect(render("33").querySelector("[data-personal-status]")!.textContent).toContain("기한내 완료");
  });

  it("has no drag handle and no delete button even if asked to draw in edit mode", () => {
    const row = render("32", true);
    expect(row.querySelector("[data-row-del]")).toBeNull();
    expect(row.querySelector('[title="드래그해서 순서 변경·회차 이동"]')).toBeNull();
  });

  it("owner: none on my own goal; avatar + name on a teammate's", () => {
    const mine = render("32");
    expect(mine.querySelector("[data-owner]")).toBeNull();
    expect(mine.textContent).not.toContain("철수");
    // 팀 과제 행의 아바타 묶음·sub/asg 는 그리지 않는다
    expect(mine.textContent).not.toMatch(/\d\/\d/);
    const other = render("33").querySelector("[data-owner]")!;
    expect(other.textContent).toContain("지은");
    expect((other.querySelector("span[style*='width']") as HTMLElement).style.width).toBe("20px");
  });

  it("보관 배지: 이탈한 소유자면 '보관됨 · 이탈'(시안 C-2), 아니면 '보관됨'", () => {
    const row = (n: TreeNode) => {
      const root = document.createElement("div");
      root.innerHTML = renderToStaticMarkup(createElement(TreeRow, { n, isEdit: false, open: true, meId: CHULSU, onToggle: () => {}, onClick: () => {} }));
      return root.querySelector("[data-archived-badge]")?.textContent;
    };
    const jieun = node("33") as LeafNode;
    expect(row({ ...jieun, archived: true })).toBe("보관됨");
    expect(row({ ...jieun, archived: true, ownerLeft: true })).toBe("보관됨 · 이탈");
    expect(row(jieun)).toBeUndefined();
  });
});
