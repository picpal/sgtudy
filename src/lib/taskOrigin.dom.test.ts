// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { clearTaskOrigin, markTaskOrigin, taskOriginOf } from "./taskOrigin";

const link = (href: string) => {
  const a = document.createElement("a");
  a.setAttribute("href", href);
  const span = a.appendChild(document.createElement("span"));
  return span;
};

describe("taskOrigin — 내 과제·내 일정 과제 링크의 출발지", () => {
  it("링크 안을 누르면 기억한다 — 다음 링크가 덮는다", () => {
    markTaskOrigin("tasks", { target: link("/my-study/aws?task=21"), button: 0 });
    expect(taskOriginOf("/my-study/aws", "21")).toBe("tasks");
    markTaskOrigin("schedule", { target: link("/my-study/aws?task=21"), button: 0 });
    expect(taskOriginOf("/my-study/aws", "21")).toBe("schedule");
    clearTaskOrigin();
    expect(taskOriginOf("/my-study/aws", "21")).toBeNull();
  });
  it("다른 방·과제면 null", () => {
    markTaskOrigin("schedule", { target: link("/my-study/aws?task=21"), button: 0 });
    expect(taskOriginOf("/my-study/gcp", "21")).toBeNull();
    expect(taskOriginOf("/my-study/aws", "22")).toBeNull();
  });
  it("새 탭으로 여는 클릭·?task= 없는 링크는 기억을 바꾸지 않고, 오래된 기억은 쓰지 않는다", () => {
    markTaskOrigin("tasks", { target: link("/my-study/aws?task=99"), button: 0 });
    markTaskOrigin("tasks", { target: link("/my-study/aws?task=21"), button: 0, metaKey: true });
    expect(taskOriginOf("/my-study/aws", "21")).toBeNull();
    markTaskOrigin("tasks", { target: link("/my-study/aws"), button: 0 });
    expect(taskOriginOf("/my-study/aws", "99")).toBe("tasks");
    markTaskOrigin("tasks", { target: link("/my-study/aws?task=21"), button: 0 });
    expect(taskOriginOf("/my-study/aws", "21", Date.now() + 60_000)).toBeNull();
  });
});
