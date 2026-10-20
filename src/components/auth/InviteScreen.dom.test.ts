// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { InvitePreview } from "@/lib/api/types";
import { ApiException } from "@/lib/api/errors";

const refresh = vi.fn();
const joinByInvite = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh }) }));
vi.mock("@/lib/api/invite", async (orig) => ({ ...(await orig<typeof import("@/lib/api/invite")>()), joinByInvite: (...a: unknown[]) => joinByInvite(...a) }));
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

  it("새 preview prop 이 오면(router.refresh) 화면이 다시 맞춰진다", () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    const root = createRoot(host);
    const el = (pv: InvitePreview) => createElement(InviteScreen, { token: "tok", preview: pv });
    act(() => root.render(el(preview({ join: { mode: "direct", via: "invite", until: "2026-10-19" } }))));
    expect(host.textContent).toContain("바로 참가하기");
    act(() => root.render(el(preview({ join: { mode: null, via: null, until: null } }))));
    expect(host.textContent).not.toContain("바로 참가하기");
    expect(host.querySelector('[role="note"]')).toBeNull();
    expect(host.textContent).toContain("모집이 끝났어요 · 그룹장에게 새 초대를 받아 주세요");
    act(() => root.unmount());
  });

  it.each(["ROOM_NOT_RECRUITING", "INVITE_EXPIRED"])("바로 참가 실패(%s): 문구를 보이고 router.refresh 로 미리보기를 다시 받는다", async (code) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    refresh.mockClear();
    joinByInvite.mockRejectedValueOnce(new ApiException({ code, message: "모집이 끝났어요" }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(InviteScreen, { token: "tok", preview: preview({ join: { mode: "direct", via: "invite", until: "2026-10-19" } }) })));
    const btn = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "바로 참가하기")!;
    await act(async () => { btn.click(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    host.remove();
  });
});
