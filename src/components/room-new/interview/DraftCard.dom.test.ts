// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { DraftCard, filledCount } from "./DraftCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("초안 카드 (D16)", () => {
  it("필수 체크 n/6 · 태그 · 더 설정 · 반영 안 된 값 · 접힘 바 요약 · 항목 누르면 바꾸기 요청", () => {
    const onAskChange = vi.fn();
    const draft = { title: "AWS SAA", intro: "소개", startDate: "2026-10-26", maxMembers: 6, minMembers: 4, rulesMd: "- a\n- b", tags: [{ slug: "aws", label: "AWS", tone: "mint" }] };
    const host = document.body.appendChild(document.createElement("div"));
    act(() => createRoot(host).render(createElement(DraftCard, { draft, dropped: [{ field: "maxMembers", reason: "최대 인원은 2~100명이에요" }], onAskChange })));
    expect(filledCount(draft)).toBe(4);
    expect(host.querySelector("details summary")?.textContent).toContain("초안 4/6");
    expect(host.querySelector("aside h2")?.textContent).toBe("초안 4/6");
    const aside = host.querySelector("aside")!;
    expect(aside.querySelector('[aria-label="태그"]')?.textContent).toBe("AWS");
    expect(aside.textContent).toContain("6명 (최소 4명)");
    expect(aside.textContent).toContain("2줄");
    expect(aside.textContent).toContain("반영 안 됨 · 최대 인원은 2~100명이에요");
    const btns = [...aside.querySelectorAll<HTMLButtonElement>('[aria-label="필수 항목"] button')];
    expect(btns.map((b) => b.disabled)).toEqual([false, false, false, true, false, true]); // 종료·공개는 아직
    act(() => btns[2].click());
    expect(onAskChange).toHaveBeenCalledWith("시작일을");
  });
});
