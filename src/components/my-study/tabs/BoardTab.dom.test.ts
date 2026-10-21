// @vitest-environment jsdom
// 보드 회차 필터 — 회차가 많아도(20주차 등) 칩이 여러 줄로 쌓이지 않게 드롭다운(listbox) 하나로 고른다.
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import { md } from "@/lib/date";
import type { Me } from "@/lib/api/types";
import type { Curriculum } from "@/lib/api/types";
import { BoardTab, boardRoundOptions } from "./BoardTab";
import { EMPTY_OVERRIDES, buildTree, type Tree } from "../model";
import { INITIAL_STATE, type ScreenState } from "../state";
import { AWS, CHULSU, REF_DAY } from "../fixtures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const me = { id: CHULSU, nickname: "철수" } as Me;

/** AWS 회차 하나를 본떠 n 개 회차를 만든 커리큘럼 (과제 없음) */
function manyRounds(n: number): Tree {
  const proto = AWS.nodes.find((x) => x.depth === 2)!;
  const nodes = Array.from({ length: n }, (_, i) => {
    const s = new Date(Date.UTC(2026, 9, 1 + i * 7));
    const e = new Date(Date.UTC(2026, 9, 7 + i * 7));
    return { ...proto, id: `r${i + 1}`, roundId: `r${i + 1}`, sortOrder: i, label: `${i + 1}주차`, title: `주제 ${i + 1}`, startDate: s.toISOString().slice(0, 10), endDate: e.toISOString().slice(0, 10) };
  });
  return buildTree({ ...AWS, nodes } as Curriculum, EMPTY_OVERRIDES, REF_DAY);
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(patch: Partial<ScreenState> = {}, t: Tree = tree) {
  const calls: unknown[] = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const S = { ...INITIAL_STATE, tab: "board" as const, ...patch };
  act(() =>
    root!.render(
      createElement(MeProvider, { me } as ComponentProps<typeof MeProvider>, createElement(TodayProvider, { today: REF_DAY } as ComponentProps<typeof TodayProvider>, createElement(BoardTab, { tree: t, S, update: (p) => calls.push(p), goLeaf: () => {} }))),
    ),
  );
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
  return { host, trigger, calls };
}
const cardTitles = (h: HTMLElement) => Array.from(h.querySelectorAll("section button[data-card-open]")).map((b) => b.querySelector("span.text-\\[14px\\]")?.textContent);
const options = (h: HTMLElement) => Array.from(h.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]'));
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("BoardTab 회차 필터 드롭다운", () => {
  it("칩·기본 select 대신 listbox 드롭다운 — 버튼에 고른 회차와 상태 꼬리표", () => {
    const { host, trigger } = mount({ bRound: "2" });
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector('[role="group"][aria-label="회차 필터"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const r2 = tree.roots.find((r) => r.id === "2")!;
    expect(trigger.textContent).toContain(`${r2.label} · EC2·S3`);
    expect(trigger.textContent).toContain("이번 회차");
    expect(trigger.getAttribute("aria-label")).toBe(`회차 필터: ${r2.label} · EC2·S3`);
  });

  it("열면 전체 회차 + 회차마다 한 줄, 이름·기간·과제 수·상태, 고른 회차가 aria-selected", () => {
    const { host, trigger } = mount({ bRound: "2", bMode: "team" });
    click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const list = host.querySelector('[role="listbox"]')!;
    expect(list.getAttribute("aria-label")).toBe("회차 필터");
    const opts = options(host);
    expect(opts.length).toBe(tree.roots.length + 1);
    expect(opts[0].textContent).toContain("전체 회차");
    const r2 = tree.roots.find((r) => r.id === "2")!;
    expect(opts[2].textContent).toContain(`${md(r2.s)} – ${md(r2.e)}`);
    expect(opts[2].textContent).toMatch(/과제 \d+개/);
    expect(opts[2].textContent).toContain("이번 회차");
    expect(opts[1].textContent).not.toContain("이번 회차");
    expect(opts.map((o) => o.getAttribute("aria-selected"))).toEqual(opts.map((_, i) => String(i === 2)));
    expect(document.activeElement).toBe(list);
  });

  it("기본값(현재 회차)대로 그 회차 과제만 보이고, 항목을 누르면 update({ bRound }) 후 닫힌다", () => {
    const { host, trigger, calls } = mount({ bRound: "2", bMode: "team" });
    const titles = cardTitles(host);
    expect(titles).toContain("EC2 인스턴스 유형 정리");
    expect(titles).not.toContain("IAM 정책 이해");
    click(trigger);
    click(options(host)[0]);
    expect(calls).toEqual([{ bRound: "all" }]);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("없는 회차 id 면 전체로 — 보이는 값과 거르는 값이 같다", () => {
    const { host, trigger } = mount({ bRound: "gone", bMode: "team" });
    expect(trigger.textContent).toContain("전체 회차");
    expect(cardTitles(host)).toEqual(expect.arrayContaining(["IAM 정책 이해", "EC2 인스턴스 유형 정리"]));
  });

  it("20회차여도 목록은 스크롤되는 패널 안 — 버튼 44px(데스크톱 40px), 좁은 폭에선 한 줄을 다 쓰고 시트로 뜬다", () => {
    const t = manyRounds(20);
    const { host, trigger } = mount({ bRound: "r20" }, t);
    expect(host.querySelectorAll("button[aria-pressed]").length).toBe(2); // 내/팀 칸반 세그만
    expect(trigger.classList.contains("h-11")).toBe(true);
    expect(trigger.classList.contains("sm:h-10")).toBe(true);
    expect(trigger.parentElement!.classList.contains("max-sm:w-full")).toBe(true);
    click(trigger);
    expect(options(host).length).toBe(21);
    const list = host.querySelector('[role="listbox"]')!;
    expect(list.classList.contains("overflow-y-auto")).toBe(true);
    const panel = host.querySelector("[data-listbox-panel]")!;
    expect(panel.className).toMatch(/max-h-\[70vh\]/); // 모바일 시트
    expect(panel.className).toContain("inset-x-0"); // 화면 폭 안
    expect(panel.className).toMatch(/sm:max-h-/); // 데스크톱 팝오버
    expect(list.getAttribute("aria-activedescendant")).toBe(options(host)[20].id);
    options(host).forEach((o) => expect(o.classList.contains("min-h-11")).toBe(true));
  });

  it("boardRoundOptions: 라벨 없는 회차는 제목만, 보관된 회차는 보관됨, 지난 회차는 종료, 과제 수", () => {
    const [r] = tree.roots;
    const opts = boardRoundOptions([{ ...r, label: null, archived: true }], REF_DAY, { [r.id]: 3 });
    expect(opts[0]).toMatchObject({ value: "all", label: "전체 회차", sub: "1개 회차 · 과제 3개" });
    expect(opts[1]).toEqual({ value: r.id, label: r.title, sub: `${md(r.s)} – ${md(r.e)} · 과제 3개`, tag: { text: "보관됨", tone: "slate" } });
    const past = boardRoundOptions([{ ...r, s: "2000-01-01", e: "2000-01-07", archived: false }], REF_DAY);
    expect(past[1].tag).toEqual({ text: "종료", tone: "muted" });
    const future = boardRoundOptions([{ ...r, s: "2999-01-01", e: "2999-01-07", archived: false }], REF_DAY);
    expect(future[1].tag).toBeUndefined();
  });
});

describe("BoardTab 카드", () => {
  it("카드는 버튼 안 버튼이 없는 div — 제목 버튼·카드 본문 어디를 눌러도 그 과제를 연다, 아바타는 한 단계 작게(26→24)", () => {
    const opened: string[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const S = { ...INITIAL_STATE, tab: "board" as const, bMode: "team" as const };
    act(() =>
      root!.render(
        createElement(MeProvider, { me } as ComponentProps<typeof MeProvider>, createElement(TodayProvider, { today: REF_DAY } as ComponentProps<typeof TodayProvider>, createElement(BoardTab, { tree, S, update: () => {}, goLeaf: (id: string) => opened.push(id) }))),
      ),
    );
    expect(host.querySelector("section button button")).toBeNull();
    const title = [...host.querySelectorAll<HTMLButtonElement>("section button[data-card-open]")].find((b) => b.parentElement!.querySelector("[data-avatar]"))!;
    const card = title.parentElement!;
    act(() => title.click());
    act(() => void card.querySelector("[data-avatar] [title]")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(opened).toHaveLength(2);
    expect(opened[0]).toBe(opened[1]);
    expect(card.className).toContain("has-[button[data-card-open]:focus-visible]:outline-2");
    expect(card.querySelector<HTMLElement>("[data-avatar] [title] > span")!.style.width).toBe("24px");
  });
});
