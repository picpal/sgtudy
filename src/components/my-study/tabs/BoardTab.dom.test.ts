// @vitest-environment jsdom
// 보드 회차 필터 — 회차가 많아도(20주차 등) 칩이 여러 줄로 쌓이지 않게 드롭다운(listbox) 하나로 고른다.
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MeProvider } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import { md } from "@/lib/date";
import type { Me } from "@/lib/api/types";
import type { Curriculum } from "@/lib/api/types";
import { BOARD_PEEK, BoardTab, boardRoundOptions } from "./BoardTab";
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

const columns = (h: HTMLElement) => Array.from(h.querySelectorAll<HTMLElement>("section[aria-label]")).map((sec) => [sec.getAttribute("aria-label"), sec.querySelector("h3 span.rounded-\\[10px\\]")?.textContent]);
const titlesIn = (h: HTMLElement, label: string) => cardTitles(h.querySelector<HTMLElement>(`section[aria-label="${label}"]`)!);
const hint = (h: HTMLElement) => [...h.querySelectorAll<HTMLButtonElement>("section button")].find((b) => b.textContent?.includes("전체 회차 보기")) ?? null;

describe("BoardTab 칸 — 예정 · 진행중 · 지연 · 제출", () => {
  it("팀 칸반: 네 칸이 이 순서, 기한이 지났는데 다 제출하지 않은 과제는 지연 칸(카드는 기한 지남 강조 그대로)", () => {
    const { host } = mount({ bRound: "all", bMode: "team" });
    expect(columns(host)).toEqual([["예정", "4"], ["진행중", "2"], ["지연", "2"], ["전원 제출", "0"]]);
    expect(titlesIn(host, "지연")).toEqual(["IAM 정책 이해", "VPC 실습"]);
    const card = host.querySelector('section[aria-label="지연"] [data-card-open]')!.parentElement!;
    expect(card.textContent).toContain("기한 지남");
    expect(card.style.borderColor).toBe("rgb(231, 169, 163)");
    expect(host.querySelector('section[aria-label="전원 제출"]')!.textContent).toContain("아직 제출이 끝난 과제가 없어요");
    expect(host.textContent).toContain("‘지연’");
  });

  it("내 칸반: 제출 완료 칸 이름, 지연 칸은 비면 안내 문구", () => {
    const { host } = mount({ bRound: "all", bMode: "mine" });
    expect(columns(host).map(([l]) => l)).toEqual(["예정", "진행중", "지연", "제출 완료"]);
    expect(host.querySelector('section[aria-label="지연"]')!.textContent).toContain("기한이 지난 과제가 없어요");
  });

  it("4열은 넓은 폭에서만 — 컨테이너 기준 1열 · 2×2 · 4열(3+1 로 떨어지지 않게)", () => {
    const { host } = mount({ bRound: "all", bMode: "team" });
    const grid = host.querySelector("section[aria-label]")!.parentElement!;
    expect(grid.parentElement!.classList.contains("@container")).toBe(true);
    expect([...grid.classList]).toEqual(expect.arrayContaining(["grid-cols-1", "@min-[420px]:grid-cols-2", "@min-[850px]:grid-cols-4"]));
  });
});

describe("BoardTab 예정 칸 — 다음 회차 안내", () => {
  it("이번 회차만 볼 때 예정이 비고 다음 회차에 내 예정 과제가 있으면 개수와 전체 회차 보기 버튼", () => {
    const { host, calls } = mount({ bRound: "2", bMode: "mine" });
    const b = hint(host)!;
    expect(b.closest("section")!.getAttribute("aria-label")).toBe("예정");
    expect(b.textContent).toContain("이후 회차 과제 4개"); // 내 과제 3(311·41·51) + 내 개인 목표 1
    expect(b.classList.contains("min-h-11")).toBe(true);
    click(b);
    expect(calls).toEqual([{ bRound: "all" }]);
  });

  it("팀 칸반은 모든 과제 기준으로 센다", () => {
    const { host } = mount({ bRound: "2", bMode: "team" });
    expect(hint(host)!.textContent).toContain("이후 회차 과제 4개");
  });

  it("전체 회차일 때, 예정 칸에 카드가 있을 때, 다음 회차 예정 과제가 0개일 때는 없다", () => {
    expect(hint(mount({ bRound: "all", bMode: "mine" }).host)).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    expect(hint(mount({ bRound: "3", bMode: "mine" }).host)).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    expect(hint(mount({ bRound: "r1", bMode: "team" }, manyRounds(3)).host)).toBeNull();
  });
});

describe("BoardTab 예정 칸 — 전체 회차 보기 ↔ 접기", () => {
  /** update 가 상태에 반영되는 하네스 */
  function mountLive(start: Partial<ScreenState>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const Live = () => {
      const [S, setS] = useState<ScreenState>({ ...INITIAL_STATE, tab: "board" as const, ...start });
      return createElement(BoardTab, { tree, S, update: (p) => setS((o) => ({ ...o, ...p })), goLeaf: () => {} });
    };
    act(() => root!.render(createElement(MeProvider, { me } as ComponentProps<typeof MeProvider>, createElement(TodayProvider, { today: REF_DAY } as ComponentProps<typeof TodayProvider>, createElement(Live)))));
    return host;
  }
  const collapseBtn = (h: HTMLElement) => [...h.querySelectorAll<HTMLButtonElement>("section button")].find((b) => b.textContent?.includes("접기")) ?? null;

  it("펼치기(aria-expanded=false) → 전체 회차 + 접기(aria-expanded=true) → 누르면 원래 회차로 복귀해 펼치기 버튼에 포커스", () => {
    const h = mountLive({ bRound: "2", bMode: "mine" });
    expect(hint(h)!.getAttribute("aria-expanded")).toBe("false");
    expect(collapseBtn(h)).toBeNull();
    click(hint(h)!);
    expect(hint(h)).toBeNull();
    const c = collapseBtn(h)!;
    expect(c.getAttribute("aria-expanded")).toBe("true");
    expect(c.closest("section")!.getAttribute("aria-label")).toBe("예정");
    click(c);
    expect(collapseBtn(h)).toBeNull();
    expect(hint(h)).not.toBeNull();
    expect(document.activeElement).toBe(hint(h));
    expect(h.querySelector('[aria-label^="회차 필터"]')!.getAttribute("aria-label")).toContain("2");
  });

  it("드롭다운으로 직접 고른 전체엔 접기가 없고, 펼친 뒤 드롭다운으로 다른 회차를 골라도 접기는 사라진다", () => {
    expect(collapseBtn(mountLive({ bRound: "all", bMode: "mine" }))).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    const h = mountLive({ bRound: "2", bMode: "mine" });
    click(hint(h)!);
    click(h.querySelector<HTMLElement>('[aria-label^="회차 필터"]')!);
    click(h.querySelectorAll<HTMLElement>('[role="option"]')[3]);
    expect(collapseBtn(h)).toBeNull();
  });
});

describe("BoardTab 칸마다 더 보기 ↔ 접기", () => {
  /** AWS 에 과제 41(예정)·11(지연)을 복제해 칸을 길게 만든 트리 */
  function longTree(todo: number, late: number): Tree {
    const clone = (src: string, n: number) => {
      const p = AWS.nodes.find((x) => x.id === src)!;
      return Array.from({ length: n }, (_, i) => ({ ...p, id: `${src}x${i}`, sortOrder: 10 + i, title: `${p.title} ${i + 1}` }));
    };
    return buildTree({ ...AWS, nodes: [...AWS.nodes, ...clone("41", todo), ...clone("11", late)] } as Curriculum, EMPTY_OVERRIDES, REF_DAY);
  }
  function mountLive(t: Tree, start: Partial<ScreenState>) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const Live = () => {
      const [S, setS] = useState<ScreenState>({ ...INITIAL_STATE, tab: "board" as const, ...start });
      return createElement(BoardTab, { tree: t, S, update: (p) => setS((o) => ({ ...o, ...p })), goLeaf: () => {} });
    };
    act(() => root!.render(createElement(MeProvider, { me } as ComponentProps<typeof MeProvider>, createElement(TodayProvider, { today: REF_DAY } as ComponentProps<typeof TodayProvider>, createElement(Live)))));
    return host;
  }
  const sec = (h: HTMLElement, label: string) => h.querySelector<HTMLElement>(`section[aria-label="${label}"]`)!;
  const moreIn = (h: HTMLElement, label: string) => sec(h, label).querySelector<HTMLButtonElement>("[data-board-more]");
  const count = (h: HTMLElement, label: string) => sec(h, label).querySelectorAll("[data-card-open]").length;

  it(`${BOARD_PEEK}개 이하면 버튼 없음, 넘으면 처음 ${BOARD_PEEK}개 + 더 보기 (+k)`, () => {
    const h = mountLive(longTree(3, 0), { bRound: "all", bMode: "team" });
    expect(count(h, "예정")).toBe(BOARD_PEEK);
    expect(moreIn(h, "지연")).toBeNull();
    const b = moreIn(h, "예정")!;
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(b.textContent).toContain("더 보기");
    expect(b.textContent).toContain("(+2)");
    expect(sec(h, "예정").querySelector("h3")!.textContent).toContain("7");
  });

  it("누르면 전부 + 접기(aria-expanded=true), 접으면 다시 5개로 돌아와 그 버튼에 포커스", () => {
    const h = mountLive(longTree(3, 0), { bRound: "all", bMode: "team" });
    click(moreIn(h, "예정")!);
    expect(count(h, "예정")).toBe(7);
    expect(moreIn(h, "예정")!.getAttribute("aria-expanded")).toBe("true");
    expect(moreIn(h, "예정")!.textContent).toContain("접기");
    click(moreIn(h, "예정")!);
    expect(count(h, "예정")).toBe(BOARD_PEEK);
    expect(document.activeElement).toBe(moreIn(h, "예정"));
  });

  it("칸마다 따로 — 예정을 펼쳐도 지연은 접힌 채", () => {
    const h = mountLive(longTree(3, 5), { bRound: "all", bMode: "team" });
    click(moreIn(h, "예정")!);
    expect(count(h, "예정")).toBe(7);
    expect(count(h, "지연")).toBe(BOARD_PEEK);
    expect(moreIn(h, "지연")!.getAttribute("aria-expanded")).toBe("false");
  });

  it("범위(내/팀)나 회차를 바꾸면 다시 접힌다", () => {
    const h = mountLive(longTree(3, 0), { bRound: "all", bMode: "team" });
    click(moreIn(h, "예정")!);
    click([...h.querySelectorAll<HTMLButtonElement>('[role="radio"], button')].find((b) => b.textContent === "내 칸반")!);
    click([...h.querySelectorAll<HTMLButtonElement>('[role="radio"], button')].find((b) => b.textContent === "팀 칸반")!);
    expect(count(h, "예정")).toBe(BOARD_PEEK);
  });

  it("전체 회차 보기로 넓힌 뒤 예정이 5개를 넘으면 더 보기와 「원래 회차로 접기」가 함께", () => {
    const h = mountLive(longTree(3, 0), { bRound: "2", bMode: "team" });
    click(hint(h)!);
    expect(moreIn(h, "예정")).not.toBeNull();
    const back = [...sec(h, "예정").querySelectorAll("button")].find((b) => b.textContent?.includes("원래 회차로 접기"))!;
    click(moreIn(h, "예정")!);
    expect(count(h, "예정")).toBe(7);
    click(back);
    expect(hint(h)).not.toBeNull();
    expect(document.activeElement).toBe(hint(h));
  });
});
