// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { focusFirst, latestApplied } from "./requests";

describe("latestApplied (재조회 순번)", () => {
  it("늦게 보낸 요청이 먼저 성공하면 앞서 보낸 늦은 응답은 버린다", () => {
    const q = latestApplied();
    const a = q.next();
    const b = q.next();
    expect(q.accept(b)).toBe(true);
    expect(q.accept(a)).toBe(false);
  });
  it("늦게 보낸 요청이 실패해도 앞서 보낸 성공 응답은 반영한다", () => {
    const q = latestApplied();
    const a = q.next();
    q.next(); // b — 실패해서 accept 를 부르지 않는다
    expect(q.accept(a)).toBe(true);
  });
  it("같은 번호는 두 번 반영하지 않는다", () => {
    const q = latestApplied();
    const a = q.next();
    expect(q.accept(a)).toBe(true);
    expect(q.accept(a)).toBe(false);
  });
});

describe("focusFirst (폼 닫은 뒤 포커스)", () => {
  it("머리 버튼이 화면에 있으면 그 버튼", () => {
    const btn = document.body.appendChild(document.createElement("button"));
    const h1 = document.body.appendChild(document.createElement("h1"));
    h1.tabIndex = -1;
    focusFirst(btn, h1);
    expect(document.activeElement).toBe(btn);
    btn.remove();
    h1.remove();
  });
  it("한도로 머리 버튼이 사라졌으면(null·떼어진 요소) 제목으로", () => {
    const h1 = document.body.appendChild(document.createElement("h1"));
    h1.tabIndex = -1;
    focusFirst(null, h1);
    expect(document.activeElement).toBe(h1);
    (document.activeElement as HTMLElement).blur();
    focusFirst(document.createElement("button"), h1);
    expect(document.activeElement).toBe(h1);
    h1.remove();
  });
});
