// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SubmissionStatusList } from "./SubmissionStatusList";
import type { StatusRow } from "../submission";

const row = (o: Partial<StatusRow>): StatusRow => ({ userId: "u3", name: "지은", tone: "peach", status: "done", me: false, released: false, submission: null, ...o });
const S = { id: "s", bodyMd: "**본문**", links: ["https://a.example"], files: [], firstSubmittedAt: "2026-10-12T03:00:00.000Z", isLate: true, updatedAt: "2026-10-12T03:00:00.000Z", author: { userId: "u3", nickname: "지은", tone: "peach" as const } };
const render = (rows: StatusRow[], note: string | null = null) => {
  const el = document.createElement("div");
  el.innerHTML = renderToStaticMarkup(createElement(SubmissionStatusList, { rows, sub: 1, asg: 2, note, onOpenFile: () => {} }));
  return el;
};

describe("SubmissionStatusList", () => {
  it("heading shows sub/asg and is focusable", () => {
    const h = render([row({})]).querySelector("h3")!;
    expect(h.textContent).toBe("제출 현황 1/2");
    expect(h.getAttribute("tabindex")).toBe("-1");
  });
  it("rows with a readable submission are 44px collapsed toggles; others are plain", () => {
    const doc = render([row({ submission: S, status: "late" }), row({ userId: "u1", name: "철수", status: "open", me: true })]);
    const btns = doc.querySelectorAll("button[aria-expanded]");
    expect(btns.length).toBe(1);
    expect(btns[0].getAttribute("aria-expanded")).toBe("false");
    expect(btns[0].className).toContain("min-h-11");
    expect(btns[0].getAttribute("aria-label")).toBe("지은 제출물 펼치기");
    expect(doc.textContent).toContain("지각");
    expect(doc.textContent).toContain("철수 (나)");
  });
  it("released authors get a tag; note renders", () => {
    const doc = render([row({ released: true, submission: S })], "참가가 승인되면 다른 사람의 제출물을 볼 수 있어요");
    expect(doc.textContent).toContain("담당 제외");
    expect(doc.textContent).toContain("참가가 승인되면");
  });
  it("archived task with no rows does not claim there are no assignees", () => {
    const el = (archived: boolean) => {
      const d = document.createElement("div");
      d.innerHTML = renderToStaticMarkup(createElement(SubmissionStatusList, { rows: [], sub: 0, asg: 0, note: null, archived, onOpenFile: () => {} }));
      return d.textContent;
    };
    expect(el(false)).toContain("아직 담당자가 없어요");
    expect(el(true)).not.toContain("아직 담당자가 없어요");
  });
  it("no inner vertical scroller", () => expect(render([row({ submission: S })]).innerHTML).not.toMatch(/overflow-y-auto|max-h-/));
});
