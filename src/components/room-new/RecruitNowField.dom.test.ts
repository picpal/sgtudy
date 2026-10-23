// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { RecruitNowField, RECRUIT_DISABLED_HINT } from "./RecruitNowField";
import { RoundsDraftSection } from "./RoundsDraftSection";

/* 바로 모집 체크(D36·D38) · 회차 초안 섹션 모양(D30·D33) */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = (el: ReturnType<typeof createElement>) => {
  const host = document.body.appendChild(document.createElement("div"));
  act(() => createRoot(host).render(el));
  return host;
};
const field = (o: object) => render(createElement(RecruitNowField, { checked: true, disabled: false, onChange: () => {}, isPublic: true, joinMode: "direct" as const, ...o }));
const note = (host: Element) => document.getElementById(host.querySelector("input")!.getAttribute("aria-describedby")!)!.textContent;

describe("RecruitNowField", () => {
  it("공개 바로·공개 승인·비공개 문구(openRecruitNote) · 라벨 44px", () => {
    expect(note(field({}))).toBe("전체 공개 방 목록에 보이고 누구나 바로 참가할 수 있어요");
    expect(note(field({ joinMode: "approval" }))).toContain("참가 신청할 수 있어요");
    expect(note(field({ isPublic: false }))).toBe("목록에는 안 보이고 초대 링크를 받은 사람만 바로 참가할 수 있어요");
    expect(field({}).querySelector("label")!.className).toContain("min-h-11");
  });
  it("disabled → 꺼짐 + 힌트 · onChange", () => {
    const off = field({ disabled: true });
    expect([off.querySelector("input")!.checked, off.querySelector("input")!.disabled, note(off)]).toEqual([false, true, RECRUIT_DISABLED_HINT]);
    const onChange = vi.fn();
    const host = field({ checked: false, onChange });
    act(() => host.querySelector("input")!.click());
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("RoundsDraftSection", () => {
  const data = {
    plan: { schema: "sgtudy.plan/v1" as const, ops: [] },
    rounds: [{ index: 0, label: "1주차", startDate: "2026-10-26", endDate: "2026-11-01", title: "IAM 기초", goalMd: "이번 주 목표: [링크](x)", tasks: ["정리"], exam: false }],
    stats: { rounds: 1, tasks: 1, exams: 0, cadenceDays: 7 as const },
    padded: 0,
  };
  const props = { data, excluded: new Set<number>(), onToggle: () => {}, stale: false, busy: false, error: null, onRegenerate: () => {} };
  it("요약(시험 0이면 생략) · summary 44px · 행 = 라벨·M/D 기간·제목 · 글은 텍스트 노드", () => {
    const host = render(createElement(RoundsDraftSection, props));
    const summary = host.querySelector("summary")!;
    expect([summary.textContent, summary.className.includes("min-h-11")]).toEqual(["회차 초안 1개 · 과제 1개", true]);
    expect(host.querySelector("label")!.textContent).toBe("1주차 · 10/26~11/1IAM 기초");
    expect(host.querySelector("a")).toBeNull();
    expect(host.textContent).toContain("[링크](x)");
  });
  it("데스크톱(1024+)은 펼침 · 모바일은 접힘", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("1024") }));
    expect(render(createElement(RoundsDraftSection, props)).querySelector("details")!.open).toBe(true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(render(createElement(RoundsDraftSection, props)).querySelector("details")!.open).toBe(false);
    vi.unstubAllGlobals();
  });
  it("busy → 체크·다시 생성 비활성 · 오류 문구 alert", () => {
    const host = render(createElement(RoundsDraftSection, { ...props, busy: true }));
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    expect(render(createElement(RoundsDraftSection, { ...props, error: "회차 초안은 지금 어려워요" })).querySelector('[role="alert"]')!.textContent).toBe("회차 초안은 지금 어려워요");
  });
});
