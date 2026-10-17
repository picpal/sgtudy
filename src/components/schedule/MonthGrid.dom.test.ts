// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Study, Task } from "@/data/schedule";
import { MonthGrid } from "./MonthGrid";

const studies: Record<string, Study> = { aws: { id: "aws", name: "AWS SAA", bg: "#DDF4EE", fg: "#0B6553", dot: "#12A386" } };
const tasks: Task[] = [
  // 10.19(월)~10.30(금): 두 주에 걸침
  { id: "a", study: "aws", title: "긴 과제", s: "2026-10-19", e: "2026-10-30", st: "open", round: "2주차" },
  // 10.25(일) 하루짜리 개인 목표 — 한 칸 폭
  { id: "p", study: "aws", title: "하루 목표", s: "2026-10-25", e: "2026-10-25", st: "planned", round: "개인", personal: true },
];

const render = () => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(MonthGrid, { y: 2026, m: 9, sel: "2026-10-12", today: "2026-10-12", studies, tasks, markers: [], onPick: () => {} }));
  return root;
};
const bar = (d: HTMLElement, id: string, week: string) => d.querySelector<HTMLElement>(`[data-week="${week}"] a[data-task="${id}"]`)!;

describe("MonthGrid — 날짜 버튼은 막대에 가리지 않는다 (Q1-7)", () => {
  it("날짜 버튼은 칸 위쪽 머리 줄(36px)만 — 막대 레인(머리 줄 아래)과 겹치지 않는다", () => {
    const d = render();
    const btn = d.querySelector<HTMLElement>('button[aria-label^="10월 22일"]')!;
    expect(btn.classList.contains("h-9")).toBe(true);
    expect(btn.classList.contains("h-full")).toBe(false);
  });
  it("칸 아래 빈 곳(막대 없는 곳)을 눌러도 그 날이 선택된다 — 칸 래퍼가 같은 날짜를 가진다", () => {
    const d = render();
    const cell = d.querySelector<HTMLElement>('button[aria-label^="10월 22일"]')!.closest("[data-day-cell]") as HTMLElement;
    expect(cell.dataset.dayCell).toBe("2026-10-22");
  });
});

describe("MonthGrid — 막대 잘림·겹침 (Q3-10)", () => {
  it("주 경계에서 이어지는 막대는 이어짐 표시 ‹ › 를 단다 (시작/끝 조각은 없음)", () => {
    const d = render();
    const first = bar(d, "a", "2026-10-18");
    expect(first.querySelector('[data-cont="next"]')).not.toBeNull();
    expect(first.querySelector('[data-cont="prev"]')).toBeNull();
    const second = bar(d, "a", "2026-10-25");
    expect(second.querySelector('[data-cont="prev"]')).not.toBeNull();
    expect(second.querySelector('[data-cont="next"]')).toBeNull();
  });
  it("한 칸짜리 막대는 [개인] 배지를 빼고 제목에 자리를 준다", () => {
    const d = render();
    const p = bar(d, "p", "2026-10-25");
    expect(p.textContent).not.toContain("개인");
    expect(p.textContent).toContain("하루 목표");
  });
});
