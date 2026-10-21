// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Notice, NoticeList } from "@/lib/api/types";
import { ApiException } from "@/lib/api/errors";
import { INITIAL_STATE, type Patch, type ScreenState } from "../state";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => {};

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: () => {} }) }));
// 에디터는 CodeMirror 대신 textarea — 값·onChange 만 본다
vi.mock("@/components/ui/markdown-editor", async () => {
  const { createElement: h } = await import("react");
  return { MarkdownEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => h("textarea", { "data-md": "", value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }) };
});
const api = vi.hoisted(() => ({ fetchNotices: vi.fn(), createNotice: vi.fn(), updateNotice: vi.fn(), deleteNotice: vi.fn(), markNoticesRead: vi.fn() }));
vi.mock("@/lib/api/notices", async (orig) => ({ ...(await orig<typeof import("@/lib/api/notices")>()), ...api }));

const { NoticeTab } = await import("./NoticeTab");
const { RoomArchivedProvider } = await import("../roomArchived");

const N = (id: string, o: Partial<Notice> = {}): Notice => ({
  id, title: `공지 ${id}`, bodyMd: `본문 **${id}**`, popup: false, pinned: false, author: { userId: "u2", nickname: "민수", tone: "mint" },
  createdAt: "2026-10-20T01:00:00.000Z", updatedAt: "2026-10-20T01:00:00.000Z", edited: false, read: true, rev: 1, ...o,
});
const L = (items: Notice[], o: Partial<NoticeList> = {}): NoticeList => ({
  items, canWrite: false, limits: { total: 100, pinned: 3, popup: 5 },
  counts: { total: items.length, pinned: items.filter((n) => n.pinned).length, popup: items.filter((n) => n.popup).length }, ...o,
});

let root: Root | null = null;
let state: ScreenState;
let upd: (p: Patch) => void;
let bump: () => void; // 목록 다시 받기(같은 화면 공지 알림 등)
const flush = () => act(async () => {});
// 폼이 쌓은 기록을 history.back 으로 걷은 뒤(popstate) 닫힌다 — jsdom 은 popstate 를 다음 틱에 보낸다
const settle = () => act(() => new Promise((r) => setTimeout(r, 10)));
type Opt = { viewer?: "leader" | "member" | "left" | "pending"; ended?: boolean; archived?: boolean; S?: Partial<ScreenState> };
async function mount(o: Opt = {}) {
  const onUnread = vi.fn();
  const toast = vi.fn();
  function H() {
    const [S, setS] = useState<ScreenState>({ ...INITIAL_STATE, tab: "notice", ...o.S });
    const [reload, setReload] = useState(0);
    const update = (p: Patch) => setS((prev) => ({ ...prev, ...(typeof p === "function" ? p(prev) : p) }));
    useEffect(() => {
      state = S;
      upd = update;
      bump = () => setReload((n) => n + 1);
    });
    return S.tab === "notice" ? createElement(NoticeTab, { slug: "aws", S, update, viewer: o.viewer ?? "member", ended: !!o.ended, onUnread, toast, reload }) : null;
  }
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  act(() => root!.render(createElement(RoomArchivedProvider, { value: !!o.archived }, createElement(H))));
  await flush();
  return { host, onUnread, toast };
}
const btn = (host: ParentNode, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text || b.getAttribute("aria-label") === text) as HTMLButtonElement | undefined;
const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>("[data-notice]")];
const typeIn = (el: HTMLInputElement | HTMLTextAreaElement, v: string) =>
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
const checkbox = (host: HTMLElement, text: string) => [...host.querySelectorAll("label")].find((l) => l.textContent?.includes(text))?.querySelector("input") as HTMLInputElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("NoticeTab — 목록·읽기", () => {
  it("빈 상태 — 그룹장은 쓰기 안내 + [공지 쓰기], 멤버는 모이는 곳 안내", async () => {
    api.fetchNotices.mockResolvedValue(L([], { canWrite: true }));
    const a = await mount({ viewer: "leader" });
    expect(api.fetchNotices).toHaveBeenCalledWith("aws");
    expect(a.host.textContent).toContain("아직 공지가 없어요");
    expect(a.host.textContent).toContain("모두가 알아야 할 규칙이나 일정을 공지로 남겨 보세요");
    expect(btn(a.host, "공지 쓰기")).toBeDefined();
    act(() => root!.unmount());
    document.body.innerHTML = "";
    api.fetchNotices.mockResolvedValue(L([]));
    const b = await mount();
    expect(b.host.textContent).toContain("그룹장이 공지를 올리면 여기에 모여요");
    expect(btn(b.host, "공지 쓰기")).toBeUndefined();
  });

  it("승인 대기 — 부르지 않고 안내만", async () => {
    const { host } = await mount({ viewer: "pending" });
    expect(api.fetchNotices).not.toHaveBeenCalled();
    expect(host.textContent).toContain("참가가 승인되면 공지를 볼 수 있어요");
  });

  it("서버 순서(고정 → 최신) 그대로 · 고정·팝업·안 읽음·수정됨 표시, 안 읽은 게 있으면 탭 점", async () => {
    api.fetchNotices.mockResolvedValue(L([N("3", { pinned: true, popup: true, read: false }), N("5", { edited: true }), N("1")]));
    const { host, onUnread } = await mount();
    expect(rows(host).map((r) => r.dataset.notice)).toEqual(["3", "5", "1"]);
    const first = rows(host)[0];
    expect(first.querySelector('[aria-label="고정"]')).not.toBeNull();
    expect(first.textContent).toContain("팝업");
    expect(first.querySelector("[data-unread]")?.textContent).toBe("안 읽음");
    expect(rows(host)[1].textContent).toContain("수정됨");
    expect(onUnread).toHaveBeenLastCalledWith(true);
  });

  it("펼치면 본문(md) + 안 읽은 공지만 한 번 읽음 처리 → 점이 사라지고 탭 점 갱신", async () => {
    api.fetchNotices.mockResolvedValue(L([N("3", { read: false }), N("1")]));
    api.markNoticesRead.mockResolvedValue({ unread: false });
    const { host, onUnread } = await mount();
    const head = rows(host)[0].querySelector("button")!;
    await act(async () => head.click());
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(rows(host)[0].querySelector("strong")?.textContent).toBe("3");
    expect(api.markNoticesRead).toHaveBeenCalledWith("aws", ["3"], [1]);
    expect(rows(host)[0].querySelector("[data-unread]")).toBeNull();
    expect(onUnread).toHaveBeenLastCalledWith(false);
    await act(async () => head.click()); // 접고
    await act(async () => head.click()); // 다시 펼쳐도
    await act(async () => rows(host)[1].querySelector("button")!.click()); // 읽은 공지도
    expect(api.markNoticesRead).toHaveBeenCalledTimes(1);
  });

  it("종료·보관 방 그룹장 — 쓰기·메뉴 없이 읽기 전용 안내", async () => {
    api.fetchNotices.mockResolvedValue(L([N("1")], { canWrite: false }));
    const { host } = await mount({ viewer: "leader", ended: true });
    expect(btn(host, "공지 쓰기")).toBeUndefined();
    expect(host.textContent).toContain("종료된 스터디라 공지를 쓰거나 고칠 수 없어요");
    await act(async () => rows(host)[0].querySelector("button")!.click());
    expect(btn(host, "공지 1 메뉴")).toBeUndefined();
    act(() => root!.unmount());
    document.body.innerHTML = "";
    const b = await mount({ viewer: "leader", archived: true });
    expect(b.host.textContent).toContain("보관된 스터디라");
  });
});

describe("NoticeTab — 그룹장 쓰기·고치기·삭제", () => {
  it("새 공지: 검증 문구 → 채우면 notice_create, 팝업 토스트, 폼 닫고 새 공지 펼침", async () => {
    api.fetchNotices.mockResolvedValue(L([], { canWrite: true }));
    api.createNotice.mockResolvedValue(N("9", { popup: true }));
    const { host, toast } = await mount({ viewer: "leader" });
    act(() => btn(host, "공지 쓰기")!.click());
    expect(state.noticeEdit).toEqual({ id: "new" });
    const title = host.querySelector<HTMLInputElement>("form input[type=text]")!;
    expect(document.activeElement).toBe(title);
    await act(async () => btn(host, "등록")!.click());
    expect(host.textContent).toContain("제목은 1~80자예요");
    expect(api.createNotice).not.toHaveBeenCalled();
    typeIn(title, "  모임 변경 ");
    await act(async () => btn(host, "등록")!.click());
    expect(host.textContent).toContain("본문은 1~10,000자예요");
    typeIn(host.querySelector<HTMLTextAreaElement>("[data-md]")!, "화요일로 옮겨요");
    act(() => checkbox(host, "입장 시 팝업으로 알리기")!.click());
    expect(state.noticeUnsaved).toBe(true);
    await act(async () => btn(host, "등록")!.click());
    expect(api.createNotice).toHaveBeenCalledWith("aws", { title: "모임 변경", bodyMd: "화요일로 옮겨요", popup: true, pinned: false });
    expect(toast).toHaveBeenCalledWith({ text: "공지를 올렸어요 · 멤버가 들어오면 팝업으로 보여요", tone: "ok" });
    await settle();
    expect(state).toMatchObject({ noticeEdit: null, noticeUnsaved: false, noticeOpen: "9" });
    expect(api.fetchNotices).toHaveBeenCalledTimes(2);
  });

  it("상한 — 팝업 5·고정 3 이면 켜는 체크 비활성 + 이유, 100개면 쓰기 비활성", async () => {
    const items = [N("1", { popup: true }), N("2", { pinned: true })];
    api.fetchNotices.mockResolvedValue(L(items, { canWrite: true, counts: { total: 2, pinned: 3, popup: 5 } }));
    const { host } = await mount({ viewer: "leader" });
    act(() => btn(host, "공지 쓰기")!.click());
    expect(checkbox(host, "입장 시 팝업으로 알리기")!.disabled).toBe(true);
    expect(host.textContent).toContain("팝업 공지는 5개까지예요 · 오래된 공지의 팝업을 꺼 주세요");
    expect(checkbox(host, "상단에 고정")!.disabled).toBe(true);
    expect(host.textContent).toContain("고정은 3개까지예요");
    act(() => root!.unmount());
    document.body.innerHTML = "";
    api.fetchNotices.mockResolvedValue(L(items, { canWrite: true, counts: { total: 100, pinned: 0, popup: 0 } }));
    const b = await mount({ viewer: "leader" });
    expect(btn(b.host, "공지 쓰기")!.disabled).toBe(true);
    expect(b.host.textContent).toContain("공지는 100개까지예요");
  });

  it("고치기: 팝업 공지면 '다시 알리기' — 바뀐 것만 + renotify 로 notice_update", async () => {
    api.fetchNotices.mockResolvedValue(L([N("1", { popup: true })], { canWrite: true }));
    api.updateNotice.mockResolvedValue(N("1", { popup: true }));
    const { host, toast } = await mount({ viewer: "leader", S: { noticeOpen: "1" } });
    act(() => btn(host, "공지 1 메뉴")!.click());
    act(() => btn(host, "수정")!.click());
    const title = host.querySelector<HTMLInputElement>("form input[type=text]")!;
    expect(title.value).toBe("공지 1");
    expect(btn(host, "저장")!.disabled).toBe(true); // 바뀐 게 없으면
    expect(checkbox(host, "입장 시 팝업으로 알리기")!.disabled).toBe(false);
    act(() => checkbox(host, "수정 내용을 다시 팝업으로 알리기")!.click());
    await act(async () => btn(host, "저장")!.click());
    expect(api.updateNotice).toHaveBeenCalledWith("aws", "1", { renotify: true });
    expect(toast).toHaveBeenCalledWith({ text: "공지를 고쳤어요 · 멤버가 들어오면 다시 팝업으로 보여요", tone: "ok" });
  });

  it("서버 상한 거절 → kind 별 문구 토스트, 목록 다시 받기", async () => {
    api.fetchNotices.mockResolvedValue(L([], { canWrite: true }));
    api.createNotice.mockRejectedValue(new ApiException({ code: "NOTICE_LIMIT", message: "NOTICE_LIMIT", details: { kind: "pinned" } }));
    const { host, toast } = await mount({ viewer: "leader" });
    act(() => btn(host, "공지 쓰기")!.click());
    typeIn(host.querySelector<HTMLInputElement>("form input[type=text]")!, "t");
    typeIn(host.querySelector<HTMLTextAreaElement>("[data-md]")!, "b");
    await act(async () => btn(host, "등록")!.click());
    expect(toast).toHaveBeenCalledWith({ text: "고정은 3개까지예요", tone: "bad" });
    expect(state.noticeEdit).toEqual({ id: "new" }); // 폼은 그대로
    expect(api.fetchNotices).toHaveBeenCalledTimes(2);
  });

  it("삭제: 확인 대화상자 → notice_delete", async () => {
    api.fetchNotices.mockResolvedValue(L([N("1")], { canWrite: true }));
    api.deleteNotice.mockResolvedValue(undefined);
    const { host, toast } = await mount({ viewer: "leader", S: { noticeOpen: "1" } });
    act(() => btn(host, "공지 1 메뉴")!.click());
    act(() => btn(host, "삭제")!.click());
    const dlg = document.querySelector('[role="alertdialog"]')!;
    expect(dlg.textContent).toContain("공지를 삭제할까요?");
    expect(dlg.textContent).toContain("삭제하면 멤버 목록에서도 사라져요.");
    await act(async () => btn(dlg, "삭제")!.click());
    expect(api.deleteNotice).toHaveBeenCalledWith("aws", "1");
    expect(toast).toHaveBeenCalledWith({ text: "공지를 삭제했어요", tone: "ok" });
  });

  it("미저장 폼에서 탭 이동 보류 → '저장하지 않은 수정이 있어요' · 계속 고치기 / 버리기면 그 탭으로", async () => {
    api.fetchNotices.mockResolvedValue(L([], { canWrite: true }));
    const { host } = await mount({ viewer: "leader" });
    act(() => btn(host, "공지 쓰기")!.click());
    typeIn(host.querySelector<HTMLInputElement>("form input[type=text]")!, "쓰는 중");
    expect(state.noticeUnsaved).toBe(true);
    // MyStudyScreen 의 탭 누름(tabPatch)이 보류한 상태
    const { tabPatch } = await import("../state");
    act(() => upd((p) => tabPatch(p, "board", false)));
    expect(state.tab).toBe("notice");
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain("저장하지 않은 수정이 있어요");
    act(() => btn(host, "계속 고치기")!.click());
    expect(state.leave).toBeNull();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    act(() => upd((p) => tabPatch(p, "board", false)));
    act(() => btn(host, "버리기")!.click());
    await settle();
    expect(state).toMatchObject({ tab: "board", noticeEdit: null, noticeUnsaved: false, leave: null });
  });

  it("미저장 폼 — 헤더 메뉴 링크(가드)도 보류, 버리기면 그 주소로", async () => {
    api.fetchNotices.mockResolvedValue(L([], { canWrite: true }));
    const { host } = await mount({ viewer: "leader" });
    act(() => btn(host, "공지 쓰기")!.click());
    typeIn(host.querySelector<HTMLInputElement>("form input[type=text]")!, "쓰는 중");
    const { guardNavigate } = await import("@/lib/leaveGuard");
    const e = { preventDefault: vi.fn() };
    act(() => guardNavigate("/tasks", e));
    expect(e.preventDefault).toHaveBeenCalled();
    act(() => btn(host, "버리기")!.click());
    await settle();
    expect(push).toHaveBeenCalledWith("/tasks");
    expect(state.noticeEdit).toBeNull();
  });

  it("브라우저 뒤로 가기 — 고치기 시작하면 같은 주소 기록을 쌓고, 뒤로 가면 다시 쌓고 묻는다 · 버리기는 그 전 화면으로", async () => {
    api.fetchNotices.mockResolvedValue(L([], { canWrite: true }));
    window.history.replaceState(null, "", "/my-study/aws?tab=notice");
    const { host } = await mount({ viewer: "leader" });
    act(() => btn(host, "공지 쓰기")!.click());
    const pushState = vi.spyOn(window.history, "pushState");
    typeIn(host.querySelector<HTMLInputElement>("form input[type=text]")!, "쓰는 중");
    typeIn(host.querySelector<HTMLInputElement>("form input[type=text]")!, "쓰는 중 더");
    expect(pushState).toHaveBeenCalledTimes(1); // 처음 고칠 때 한 번만
    act(() => window.history.back());
    await settle();
    expect(pushState).toHaveBeenCalledTimes(2); // 빠진 기록을 다시 쌓았다
    pushState.mockRestore();
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain("저장하지 않은 수정이 있어요");
    expect(state.noticeEdit).toEqual({ id: "new" }); // 초안은 그대로
    act(() => btn(host, "계속 고치기")!.click());
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    act(() => window.history.back());
    await settle();
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    act(() => btn(host, "버리기")!.click());
    expect(go).toHaveBeenCalledWith(-2);
    expect(state.noticeEdit).toBeNull();
    go.mockRestore();
  });

  it("[취소] 는 쌓은 기록을 걷고 닫는다", async () => {
    api.fetchNotices.mockResolvedValue(L([], { canWrite: true }));
    const { host } = await mount({ viewer: "leader" });
    act(() => btn(host, "공지 쓰기")!.click());
    typeIn(host.querySelector<HTMLInputElement>("form input[type=text]")!, "쓰는 중");
    const back = vi.spyOn(window.history, "back");
    act(() => btn(host, "취소")!.click());
    expect(back).toHaveBeenCalledTimes(1);
    await settle();
    expect(state.noticeEdit).toBeNull();
    back.mockRestore();
  });
});

describe("NoticeTab — 고치는 중 대상이 바뀜 (리뷰 I2)", () => {
  it("폼이 열린 동안 행 메뉴는 숨는다", async () => {
    api.fetchNotices.mockResolvedValue(L([N("1")], { canWrite: true }));
    const { host } = await mount({ viewer: "leader", S: { noticeOpen: "1" } });
    act(() => btn(host, "공지 1 메뉴")!.click());
    act(() => btn(host, "수정")!.click());
    expect(btn(host, "공지 1 메뉴")).toBeUndefined();
  });

  it("고치던 공지가 삭제됨 → 안내 + 저장 막힘, 새 공지로 올리지 않는다", async () => {
    api.fetchNotices.mockResolvedValue(L([N("1")], { canWrite: true }));
    api.updateNotice.mockRejectedValue(new ApiException({ code: "NOTICE_NOT_FOUND", message: "공지를 찾을 수 없어요" }));
    const { host } = await mount({ viewer: "leader", S: { noticeEdit: { id: "1" } } });
    expect(host.querySelector("h3")?.textContent).toBe("공지 고치기");
    typeIn(host.querySelector<HTMLInputElement>("form input[type=text]")!, "고친 제목");
    api.fetchNotices.mockResolvedValue(L([], { canWrite: true }));
    await act(async () => btn(host, "저장")!.click());
    await flush();
    expect(host.querySelector("h3")?.textContent).toBe("공지 고치기"); // "새 공지" 로 바뀌지 않는다
    expect(host.querySelector('form [role="alert"]')?.textContent).toContain("이 공지는 삭제됐어요");
    expect(btn(host, "저장")!.disabled).toBe(true);
    expect(api.createNotice).not.toHaveBeenCalled();
  });

  it("다른 곳에서 고정이 바뀌어도 저장은 내가 바꾼 것만 — 고정을 되돌리지 않는다", async () => {
    api.fetchNotices.mockResolvedValue(L([N("1")], { canWrite: true }));
    api.updateNotice.mockResolvedValue(N("1"));
    const { host } = await mount({ viewer: "leader", S: { noticeEdit: { id: "1" } } });
    api.fetchNotices.mockResolvedValue(L([N("1", { pinned: true })], { canWrite: true }));
    act(() => bump());
    await flush();
    typeIn(host.querySelector<HTMLInputElement>("form input[type=text]")!, "고친 제목");
    await act(async () => btn(host, "저장")!.click());
    expect(api.updateNotice).toHaveBeenCalledWith("aws", "1", { title: "고친 제목" });
  });
});
