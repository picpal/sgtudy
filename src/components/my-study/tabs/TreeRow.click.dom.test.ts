// @vitest-environment jsdom
// 진행목표 행: 행 본문 버튼 밖에 놓인 배지·칸(개인 목표 상태 "예정", 담당 아바타·제출 수, 회차 진척률)을 눌러도
// 행 동작(상세·편집 열기)이 된다. 행 안의 다른 버튼(펼치기·+·삭제)과 끌기 손잡이는 자기 동작만 한다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TreeRow } from "./TreeRow";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { AWS, CHULSU, REF_DAY } from "../fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const node = (id: string) => t.nodes.find((n) => n.id === id)!;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
});

function mount(id: string, extra: Partial<ComponentProps<typeof TreeRow>> = {}) {
  const fns = { onClick: vi.fn(), onToggle: vi.fn(), onRemove: vi.fn(), onAddChild: vi.fn(), onPointerDown: vi.fn() };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(TreeRow, { n: node(id), isEdit: false, open: true, meId: CHULSU, onToggle: fns.onToggle, onClick: fns.onClick, onRemove: fns.onRemove, onAddChild: fns.onAddChild, dragHandle: { onPointerDown: fns.onPointerDown }, ...extra }),
    ),
  );
  return { host, ...fns };
}
const click = (el: Element | null) => {
  expect(el).not.toBeNull();
  act(() => (el as HTMLElement).click());
};

describe("TreeRow — 행 본문 밖 배지를 눌러도 행 동작", () => {
  it("개인 목표 행: 상태 배지(예정)를 누르면 상세 열기", () => {
    const { host, onClick } = mount("32");
    const chip = host.querySelector("[data-personal-status]");
    expect(chip?.textContent).toBe("예정");
    click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("과제 행: 담당 아바타·제출 수 칸을 누르면 상세 열기", () => {
    const { host, onClick } = mount("311");
    const row = host.querySelector("[data-node] > div")!;
    const trailing = Array.from(row.children).filter((c) => !c.matches("button, [data-row-main]") && !c.querySelector("[data-row-main]"));
    expect(trailing.length).toBeGreaterThan(0);
    for (const c of trailing) click(c);
    expect(onClick).toHaveBeenCalledTimes(trailing.length);
  });

  it("회차 행: 진척률을 누르면 상세 열기, 펼치기 버튼은 펼치기만", () => {
    const { host, onClick, onToggle } = mount(t.roots[0].id);
    click(Array.from(host.querySelectorAll("span")).find((s) => /^\d+%$/.test(s.textContent ?? "")) ?? null);
    expect(onClick).toHaveBeenCalledTimes(1);
    click(host.querySelector('button[aria-label$="접기"]'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("행 본문 버튼은 한 번만 연다(이중 호출 없음)", () => {
    const { host, onClick } = mount("311");
    click(host.querySelector("[data-row-main]"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("편집 모드: + · 삭제 버튼과 끌기 손잡이는 행을 열지 않는다", () => {
    const r = mount(t.roots[0].id, { isEdit: true });
    click(r.host.querySelector("[data-row-del]"));
    click(r.host.querySelector('button[aria-label$="과제 추가"]'));
    expect(r.onRemove).toHaveBeenCalledTimes(1);
    expect(r.onAddChild).toHaveBeenCalledTimes(1);
    expect(r.onClick).not.toHaveBeenCalled();
    act(() => root?.unmount());
    host?.remove();
    const leaf = mount("311", { isEdit: true });
    click(leaf.host.querySelector('[title="드래그해서 순서 변경·회차 이동"]'));
    expect(leaf.onClick).not.toHaveBeenCalled();
  });
});
