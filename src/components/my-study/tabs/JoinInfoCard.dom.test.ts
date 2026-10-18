// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { StudyRoom } from "@/lib/api/my-study";
import { AWS } from "../fixtures";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { JoinInfoCard } from "./JoinInfoCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tree = buildTree(AWS, EMPTY_OVERRIDES, "2026-10-12");
const base = {
  id: "aws", title: "AWS", intro: "", status: "active", draft: false, archived: false, leaveRequest: null, period: "", dday: "D-80", ddayLong: "종료까지 D-80",
  capCur: 3, capMax: 6, minText: "", minOk: true, members: [], action: "joined", next: null,
} as unknown as StudyRoom;

const render = (room: StudyRoom) => {
  const onCancel = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act(() => root.render(createElement(JoinInfoCard, { room, tree, onMyTasks: () => {}, goLeaf: () => {}, onCancel, busy: false })));
  return { host, root, onCancel };
};
const btn = (host: HTMLElement, text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === text);

afterEach(() => {
  document.body.innerHTML = "";
});

// 시나리오 QA D3 (#4): 진행 중에는 참가 취소 대신 그룹장에게 탈퇴를 요청한다
describe("JoinInfoCard — 진행 중 탈퇴 요청", () => {
  it("참가 중이면 [탈퇴 요청] 과 안내", () => {
    const { host, root, onCancel } = render(base);
    expect(host.textContent).toContain("진행 중에는 그룹장이 탈퇴를 처리해요 · 제출 기록은 남아요");
    act(() => btn(host, "탈퇴 요청")!.click());
    expect(onCancel).toHaveBeenCalledWith("leaveRequest");
    act(() => root.unmount());
  });
  it("요청 중이면 요청 날짜·사유와 [탈퇴 요청 취소]", () => {
    const { host, root, onCancel } = render({ ...base, leaveRequest: { on: "10.12", reason: "이사 가요" } });
    const box = host.querySelector("[data-leave-request]")!;
    expect(box.getAttribute("role")).toBe("status");
    expect(box.textContent).toContain("10.12에 탈퇴를 요청했어요 · 그룹장이 처리하면 알려 드려요");
    expect(box.textContent).toContain("이사 가요");
    expect(btn(host, "탈퇴 요청")).toBeUndefined();
    act(() => btn(host, "탈퇴 요청 취소")!.click());
    expect(onCancel).toHaveBeenCalledWith("leaveRequestCancel");
    act(() => root.unmount());
  });
});

// 시나리오 QA #6: 보관된 방은 "모집 종료" 가 아니라 보관된 스터디
describe("JoinInfoCard — 보관된 방", () => {
  it("배지·버튼·안내가 모두 보관", () => {
    const { host, root } = render({ ...base, archived: true, action: "closed", dday: "보관됨", ddayLong: "보관된 스터디 · 기록만 볼 수 있어요" });
    expect(host.textContent).toContain("보관됨");
    expect(host.textContent).not.toContain("모집 종료");
    expect(host.textContent).not.toContain("진행중");
    expect(btn(host, "보관된 스터디")?.disabled).toBe(true);
    act(() => root.unmount());
  });
});
