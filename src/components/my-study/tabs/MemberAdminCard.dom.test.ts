// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RoomMemberDto } from "@/lib/api/types";
import { MemberAdminCard } from "./MemberAdminCard";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { AWS, REF_DAY } from "../fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const M = (userId: string, nickname: string, role: "leader" | "member" = "member"): RoomMemberDto =>
  ({ userId, nickname, tone: "mint", role, status: "active", joinedAt: null, canEditCurriculum: role === "leader" }) as RoomMemberDto;
const members = [M("u2", "민수", "leader"), M("u3", "지은"), M("u1", "철수")];

function render(roundId: string | null) {
  const html = renderToStaticMarkup(createElement(MemberAdminCard, { slug: "aws", members, meId: "u2", toast: () => {}, tree, roundId, onShowOthers: () => {} }));
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}
const cell = (doc: HTMLElement, uid: string) => doc.querySelector(`[data-member="${uid}"] [data-personal-stat]`)?.textContent;

describe("MemberAdminCard 개인 목표 열", () => {
  it("이번 회차 완료/전체 · 없으면 '없음'", () => {
    const doc = render("3");
    expect(cell(doc, "u3")).toBe("1/1");
    expect(cell(doc, "u1")).toBe("0/1");
    expect(cell(doc, "u2")).toBe("없음");
  });
  it("다른 회차면 그 회차만 센다", () => {
    expect(cell(render("2"), "u3")).toBe("없음");
  });
  it("지금 회차가 없으면 열은 '–'", () => {
    expect(cell(render(null), "u3")).toBe("–");
  });
  it("표 아래 '팀원 개인 목표 보기 →' 버튼", () => {
    const btn = Array.from(render("3").querySelectorAll("button")).find((b) => b.textContent?.includes("팀원 개인 목표 보기"));
    expect(btn).toBeTruthy();
  });
});
