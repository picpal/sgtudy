// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalSection } from "./PersonalSection";
import { EMPTY_OVERRIDES, buildTree, type ParentNode } from "../model";
import { AWS, CHULSU, REF_DAY } from "../fixtures";
import type { RoomStatus } from "../submission";

const LEADER = "u2";
const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const r3 = tree.roots.find((r) => r.id === "3")!;
const api = { createPersonal: async () => true, completePersonal: async () => true };
function render(round: ParentNode, meId: string, isLeader: boolean, roomStatus: RoomStatus = "active") {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(PersonalSection, { round, meId, isLeader, roomStatus, personal: { canAdd: true, perRound: 20 }, api, onOpen: () => {} }));
  return root;
}
const othersToggle = (root: HTMLElement) => Array.from(root.querySelectorAll("button[aria-expanded]")).find((b) => b.textContent?.includes("팀원 개인 목표"));

describe("PersonalSection (회차 상세 개인 목표)", () => {
  it("팀원 것 머리 = 보관 제외 개수", () => {
    expect(othersToggle(render(r3, CHULSU, false))?.textContent).toBe("팀원 개인 목표 1개");
  });
  it("그룹장에게 보관된 팀원 목표만 있으면 'n개 · 보관 m' (시안 C-4)", () => {
    const r = { ...r3, kids: r3.kids.map((k) => (k.id === "33" || k.id === "32" ? { ...k, archived: true } : k)) } as ParentNode;
    const root = render(r, LEADER, true);
    expect(othersToggle(root)?.textContent).toBe("팀원 개인 목표 0개 · 보관 2");
    expect(root.querySelector("section[aria-label^='팀원 개인 목표']")?.getAttribute("aria-label")).toBe("팀원 개인 목표 0개 · 보관 2");
  });
  it("체크 버튼: 완료 상태를 aria-pressed 로, 진행 중이 아닌 방이면 비활성 + 이유를 aria-describedby 로", () => {
    const active = render(r3, CHULSU, false).querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    expect(active.getAttribute("aria-pressed")).toBe("false");
    expect(active.disabled).toBe(false);
    expect(active.getAttribute("aria-describedby")).toBeNull();
    const root = render(r3, CHULSU, false, "recruit");
    const off = root.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    expect(off.disabled).toBe(true);
    const id = off.getAttribute("aria-describedby")!;
    expect(root.querySelector(`#${CSS.escape(id)}`)?.textContent).toBe("스터디가 진행 중일 때 완료할 수 있어요");
  });
});
