import { describe, expect, it, vi } from "vitest";
import { guardNavigate, holdSamePage, samePage, screenKeyOf, setLeaveGuard, setScreenKey } from "./leaveGuard";

describe("leaveGuard (Q2-1 — 저장하지 않은 편집이 있으면 앱 안 링크 이동을 보류)", () => {
  const ev = () => ({ preventDefault: vi.fn() });
  it("가드가 없으면 그대로 이동", () => {
    const e = ev();
    guardNavigate("/tasks", e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
  it("가드가 true 를 돌려주면 이동을 막고, 주소를 넘긴다", () => {
    const g = vi.fn(() => true);
    const off = setLeaveGuard(g);
    const e = ev();
    guardNavigate("/schedule", e);
    expect(g).toHaveBeenCalledWith("/schedule");
    expect(e.preventDefault).toHaveBeenCalled();
    off();
    const e2 = ev();
    guardNavigate("/schedule", e2);
    expect(e2.preventDefault).not.toHaveBeenCalled();
  });
  it("뒤에 건 가드가 이미 바뀌었으면 앞 가드의 해제는 뒤 가드를 지우지 않는다", () => {
    const off1 = setLeaveGuard(() => true);
    const off2 = setLeaveGuard(() => true);
    off1();
    const e = ev();
    guardNavigate("/", e);
    expect(e.preventDefault).toHaveBeenCalled();
    off2();
  });
});

describe("samePage — 내 스터디 화면 key(page.tsx: id·task·tab) 와 같은 규칙 (E 리뷰 minor 1)", () => {
  it("경로가 다르면 false", () => {
    expect(samePage("/schedule", "http://x/my-study/aws")).toBe(false);
  });
  it("정규화한 (task, tab ?? overview) 가 같으면 true — item·mode·해시·모르는 탭은 무시", () => {
    expect(samePage("/my-study/aws?item=3#x", "http://x/my-study/aws")).toBe(true);
    expect(samePage("/my-study/aws?tab=overview", "http://x/my-study/aws")).toBe(true);
    expect(samePage("/my-study/aws?tab=zzz", "http://x/my-study/aws")).toBe(true);
    expect(samePage("/my-study/aws?task=abc", "http://x/my-study/aws")).toBe(true);
  });
  it("(a) 같은 tab·task 로 가면 다시 마운트되지 않으니 true", () => {
    expect(samePage("/my-study/aws?tab=curriculum", "http://x/my-study/aws?tab=curriculum&item=3")).toBe(true);
    expect(samePage("/my-study/aws?task=12", "http://x/my-study/aws?task=12")).toBe(true);
  });
  it("(b) ?tab=curriculum 으로 연 화면에서 tab 없는 같은 방 주소로 가면 key 가 overview 로 바뀌니 false", () => {
    expect(samePage("/my-study/aws", "http://x/my-study/aws?tab=curriculum&item=3")).toBe(false);
  });
  it("task·tab 이 다르면 false (N-1)", () => {
    expect(samePage("/my-study/aws?task=12", "http://x/my-study/aws?tab=curriculum&item=3")).toBe(false);
    expect(samePage("/my-study/aws?tab=board", "http://x/my-study/aws")).toBe(false);
  });
  it("마운트된 화면 key 가 있으면 지금 주소(탭을 옮기며 바뀐 ?tab=)보다 그 key 를 쓴다", () => {
    const off = setScreenKey({ tab: "curriculum", task: "" });
    expect(samePage("/my-study/aws?tab=curriculum", "http://x/my-study/aws?tab=board")).toBe(true);
    expect(samePage("/my-study/aws", "http://x/my-study/aws")).toBe(false);
    off();
    expect(samePage("/my-study/aws", "http://x/my-study/aws")).toBe(true);
  });
  it("screenKeyOf 는 page.tsx 규칙 — 모르는 탭은 overview, 숫자 아닌 task 는 빈 값", () => {
    expect(screenKeyOf(new URLSearchParams("tab=gantt&task=7"))).toEqual({ tab: "gantt", task: "" + 7 });
    expect(screenKeyOf({ tab: "x", task: "1a" })).toEqual({ tab: "overview", task: "" });
  });
});

// 최종 리뷰 I2: 깨끗한 편집 화면이 같은 화면 알림 링크(#applications 등)를 삼키지 않는다 — 해시 링크는 막지 않고 이동시킨다
describe("holdSamePage — 같은 화면 이동을 편집 화면이 대신 처리하나", () => {
  const here = "http://x/my-study/aws?tab=curriculum&item=3&mode=edit";
  it("해시 없는 같은 화면 주소는 보류(편집 화면만 닫는다)", () => {
    expect(holdSamePage("/my-study/aws?tab=curriculum", here, { tab: "curriculum", task: "" })).toBe(true);
  });
  it("해시가 있는 같은 화면 알림 링크는 보류하지 않는다", () => {
    expect(holdSamePage("/my-study/aws#applications", here, { tab: "overview", task: "" })).toBe(false);
  });
  it("다른 화면은 보류하지 않는다", () => {
    expect(holdSamePage("/my-study/other", here, { tab: "curriculum", task: "" })).toBe(false);
  });
});
