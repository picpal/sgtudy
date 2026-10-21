// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import type { ApiToken, CreatedToken } from "@/lib/api/tokens";

const RAW = `sgt_pat_${"a".repeat(64)}`;
const row = (id: string, over: Partial<ApiToken> = {}): ApiToken => ({
  id, name: `토큰 ${id}`, prefix: "sgt_pat_aaaaaaaa", scopes: ["read", "curriculum:write"], createdAt: "2026-10-20T00:00:00.000Z",
  expiresAt: "2027-01-18T00:00:00.000Z", lastUsedAt: null, expired: false, ...over,
});
const api = vi.hoisted(() => ({ listTokens: vi.fn(), createToken: vi.fn(), revokeToken: vi.fn() }));
vi.mock("@/lib/api/tokens", async (orig) => ({ ...(await orig<typeof import("@/lib/api/tokens")>()), ...api }));

const { ApiTokens } = await import("./ApiTokens");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("ApiTokens — 정적", () => {
  it("섹션·설명·스코프 3개(기본 켬)·만료 90일·만들기 버튼", () => {
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(createElement(ApiTokens));
    expect(root.querySelector('section[aria-label="AI 연결"]')).not.toBeNull();
    expect(root.textContent).toContain("토큰은 비밀번호처럼 다뤄 주세요");
    const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
    expect(boxes.map((b) => b.closest("label")?.textContent)).toEqual(["읽기", "진행목표 편집", "개인 목표 추가"]);
    expect(boxes.every((b) => b.hasAttribute("checked"))).toBe(true);
    expect(root.textContent).toContain("90일 뒤");
    expect(root.querySelector('button[type="submit"]')?.textContent).toBe("토큰 만들기");
  });
});

describe("ApiTokens — 만들기·폐기", () => {
  let host: HTMLDivElement;
  let root: Root;
  const write = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
  beforeEach(async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    api.listTokens.mockResolvedValue({ today: "2026-10-21", items: [row("t1", { expired: true, lastUsedAt: "2026-10-20T01:00:00.000Z" })] });
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    act(() => root.render(createElement(ApiTokens)));
    await flush();
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllMocks();
  });

  it("목록: prefix… · 스코프 라벨 · 마지막 사용 · 만료됨 배지", () => {
    const li = host.querySelector("li")!;
    expect(li.textContent).toContain("sgt_pat_aaaaaaaa…");
    expect(li.textContent).toContain("읽기 · 진행목표 편집");
    expect(li.textContent).toContain("10.20 사용");
    expect(li.textContent).toContain("만료됨");
    expect(li.querySelector('button[aria-label="토큰 t1 토큰 폐기"]')).not.toBeNull();
  });

  it("만들면 원문·설치 명령이 한 번 보이고, 숨기면 사라진다", async () => {
    const made: CreatedToken = { ...row("t2", { name: "노트북" }), token: RAW };
    api.createToken.mockResolvedValue(made);
    api.listTokens.mockResolvedValue({ today: "2026-10-21", items: [row("t2", { name: "노트북" })] });
    const off = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!; // 읽기 끄기
    act(() => off.click());
    act(() => host.querySelector("form")!.requestSubmit());
    await flush();
    expect(api.createToken).toHaveBeenCalledWith("Claude Code", ["curriculum:write", "personal:write"], 90);
    expect(host.textContent).toContain(RAW);
    expect(host.textContent).toContain(`claude mcp add --scope user --transport http sgtudy ${window.location.origin}/api/mcp --header "Authorization: Bearer ${RAW}"`);
    expect(host.textContent).toContain("이 화면을 떠나면 토큰을 다시 볼 수 없어요");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="토큰 복사"]')!.click());
    expect(write).toHaveBeenCalledWith(RAW);
    act(() => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.startsWith("다 했어요"))!.click());
    expect(host.textContent).not.toContain(RAW);
    expect(host.querySelector("form")).not.toBeNull();
  });

  it("복사가 막히면 알리고 원문은 그대로 보인다", async () => {
    api.createToken.mockResolvedValue({ ...row("t2"), token: RAW });
    act(() => host.querySelector("form")!.requestSubmit());
    await flush();
    write.mockRejectedValueOnce(new Error("denied"));
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="토큰 복사"]')!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("복사하지 못했어요 · 직접 선택해 복사해 주세요");
    expect(host.querySelector("code.select-all")?.textContent).toBeTruthy();
    expect(host.textContent).toContain(RAW);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="토큰 복사"]')!.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('button[aria-label="토큰 복사"]')?.textContent).toBe("복사했어요");
  });

  it("폐기는 앱 확인 대화상자를 거친다", async () => {
    api.revokeToken.mockResolvedValue({ today: "2026-10-21", items: [] });
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="토큰 t1 토큰 폐기"]')!.click());
    const dlg = document.querySelector('[role="alertdialog"]')!;
    expect(dlg.textContent).toContain("토큰 t1");
    expect(api.revokeToken).not.toHaveBeenCalled();
    act(() => Array.from(dlg.querySelectorAll("button")).find((b) => b.textContent === "폐기")!.click());
    await flush();
    expect(api.revokeToken).toHaveBeenCalledWith("t1");
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.textContent).toContain("아직 만든 토큰이 없어요");
  });
});
