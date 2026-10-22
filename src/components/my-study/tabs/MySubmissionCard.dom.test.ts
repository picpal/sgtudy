// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MySubmissionCardView } from "./MySubmissionCard";

const sub = { id: "s", bodyMd: "본문", links: [], files: [], firstSubmittedAt: "2026-10-12T03:00:00.000Z", isLate: false, updatedAt: "2026-10-12T03:00:00.000Z" };
const html = (p: Parameters<typeof MySubmissionCardView>[0]) => { const d = document.createElement("div"); d.innerHTML = renderToStaticMarkup(createElement(MySubmissionCardView, p)); return d; };

describe("MySubmissionCardView", () => {
  it("submitted: badge, meta, 44px 수정하기", () => {
    const d = html({ state: { kind: "submitted" }, badge: { status: "done", text: "기한내 제출" }, mine: sub, composer: null, onEdit: () => {}, onOpenFile: () => {} });
    expect(d.querySelector("h3")?.textContent).toBe("내 제출");
    expect(d.textContent).toContain("기한내 제출");
    expect(d.textContent).toContain("처음 제출 10.12(월) 12:00");
    const b = Array.from(d.querySelectorAll("button")).find((x) => x.textContent === "수정하기")!;
    expect(b.className).toMatch(/h-11|min-h-11/);
  });
  it("is a tinted panel region (not a bordered card) — h3 labels it, sub line says what to do here", () => {
    const d = html({ state: { kind: "compose" }, badge: { status: "open", text: "제출 전 · D-3" }, mine: null, composer: null, onEdit: () => {}, onOpenFile: () => {}, sub: "이 과제의 제출물을 여기에 올려요 · 마감 10.18(일)" });
    const s = d.querySelector("section")!;
    expect(s.getAttribute("aria-labelledby")).toBe("my-sub-title");
    expect(s.querySelector("#my-sub-title")?.tagName).toBe("H3");
    expect(s.className).toContain("bg-bg-main");
    expect(s.className).not.toMatch(/(^|\s)border(\s|$)/);
    expect(s.textContent).toContain("마감 10.18(일)");
    expect(s.textContent).toContain("제출 전 · D-3");
  });
  it("readonly shows the note and no edit button", () => {
    const d = html({ state: { kind: "readonly", note: "보관된 과제라 제출·수정할 수 없어요" }, badge: { status: "done", text: "기한내 제출" }, mine: sub, composer: null, onEdit: () => {}, onOpenFile: () => {} });
    expect(d.textContent).toContain("보관된 과제라");
    expect(Array.from(d.querySelectorAll("button")).some((x) => x.textContent === "수정하기")).toBe(false);
  });
  it("blocked shows only the note", () => {
    const d = html({ state: { kind: "blocked", note: "10.15(목)부터 제출할 수 있어요" }, badge: { status: "planned", text: "예정" }, mine: null, composer: null, onEdit: () => {}, onOpenFile: () => {} });
    expect(d.textContent).toContain("10.15(목)부터");
    expect(d.querySelector("textarea, [contenteditable]")).toBeNull();
  });
  it("지각 안내 — 팀은 지각, 개인 목표는 늦게 완료", () => {
    const late = { ...sub, isLate: true };
    const team = html({ state: { kind: "submitted" }, badge: { status: "late", text: "지각 제출" }, mine: late, composer: null, onEdit: () => {}, onOpenFile: () => {} });
    expect(team.textContent).toContain("마감 뒤에 처음 제출해 지각으로 기록됐어요");
    const mine = html({ state: { kind: "submitted" }, badge: { status: "late", text: "늦게 완료" }, mine: late, composer: null, personal: true, onEdit: () => {}, onOpenFile: () => {} });
    expect(mine.textContent).toContain("마감 뒤에 완료해 늦게 완료로 기록됐어요");
    expect(mine.textContent).not.toContain("지각");
    expect(mine.textContent).toContain("완료 10.12(월) 12:00");
    expect(mine.textContent).not.toContain("처음 제출");
  });
});
