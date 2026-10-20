// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { InvitePreview } from "@/lib/api/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
const { InviteScreen } = await import("./InviteScreen");

const preview = (over: Partial<InvitePreview> & { status?: string }): InvitePreview =>
  ({
    room: { slug: "aws", title: "AWS 스터디", intro: "", startDate: "2026-10-01", endDate: "2026-12-01", memberCount: 3, maxMembers: 8, status: over.status ?? "active", isPublic: true, joinMode: "direct", tags: [] },
    leader: { userId: "u1", nickname: "리더", tone: "mint" },
    me: { state: "none" },
    ...over,
  }) as unknown as InvitePreview;

const render = (p: InvitePreview) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(InviteScreen, { token: "tok", preview: p }));
  return root;
};

describe("InviteScreen 0032", () => {
  it("via invite: 안내 박스 + 바로 참가하기", () => {
    const root = render(preview({ join: { mode: "direct", via: "invite", until: "2026-10-19" } }));
    const note = root.querySelector('[role="note"]')!;
    expect(note.textContent).toContain("진행중인 스터디예요");
    expect(note.textContent).toContain("초대로 바로 참가 · 10.19까지");
    expect(Array.from(root.querySelectorAll("button")).map((b) => b.textContent)).toContain("바로 참가하기");
  });
  it("via extra: 추가 모집 · mm.dd까지", () => {
    const root = render(preview({ join: { mode: "direct", via: "extra", until: "2026-10-19" } }));
    expect(root.querySelector('[role="note"]')?.textContent).toContain("추가 모집 · 10.19까지");
    expect(Array.from(root.querySelectorAll("button")).map((b) => b.textContent)).toContain("참가하기");
  });
  it("진행중 + mode null: 닫힘 문구", () => {
    const root = render(preview({ join: { mode: null, via: null, until: null } }));
    expect(root.querySelector("button")?.textContent).toBe("모집이 끝났어요 · 그룹장에게 새 초대를 받아 주세요");
    expect(root.querySelector('[role="note"]')).toBeNull();
  });
});
