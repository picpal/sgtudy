// @vitest-environment jsdom
// 보드 회차 필터 — 회차가 많아도(20주차 등) 칩이 여러 줄로 쌓이지 않게 select 하나로 고른다.
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
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="회차 필터"]')!;
  return { host, select, calls };
}
const cardTitles = (h: HTMLElement) => Array.from(h.querySelectorAll("section button")).map((b) => b.querySelector("span.text-\\[14px\\]")?.textContent);

describe("BoardTab 회차 필터 select", () => {
  it("칩 대신 select 하나 — 전체 회차 + 회차마다 한 줄, 글에 이름·기간, 오늘이 든 회차 표시", () => {
    const { host, select } = mount({ bRound: "2" });
    expect(select).not.toBeNull();
    expect(host.querySelector('[role="group"][aria-label="회차 필터"]')).toBeNull();
    const opts = Array.from(select.options);
    expect(opts.map((o) => o.value)).toEqual(["all", ...tree.roots.map((r) => r.id)]);
    expect(opts[0].textContent).toBe("전체 회차");
    const r2 = tree.roots.find((r) => r.id === "2")!;
    expect(opts[2].textContent).toBe(`${r2.label} · EC2·S3 (${md(r2.s)} – ${md(r2.e)}) · 이번 회차`);
    expect(opts[1].textContent).not.toContain("이번 회차");
    expect(select.value).toBe("2");
  });

  it("기본값(현재 회차)대로 그 회차 과제만 보이고, 바꾸면 update({ bRound })", () => {
    const { host, select, calls } = mount({ bRound: "2", bMode: "team" });
    const titles = cardTitles(host);
    expect(titles).toContain("EC2 인스턴스 유형 정리");
    expect(titles).not.toContain("IAM 정책 이해");
    act(() => {
      select.value = "all";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(calls).toEqual([{ bRound: "all" }]);
  });

  it("없는 회차 id 면 전체로 — 보이는 값과 거르는 값이 같다", () => {
    const { host, select } = mount({ bRound: "gone", bMode: "team" });
    expect(select.value).toBe("all");
    expect(cardTitles(host)).toEqual(expect.arrayContaining(["IAM 정책 이해", "EC2 인스턴스 유형 정리"]));
  });

  it("20회차여도 선택지는 select 안 — 누르는 영역 44px, 데스크톱 상자는 세그 높이, 좁은 폭에선 한 줄을 다 쓴다", () => {
    const t = manyRounds(20);
    const { host, select } = mount({ bRound: "r20" }, t);
    expect(select.options.length).toBe(21);
    expect(select.value).toBe("r20");
    expect(host.querySelectorAll("button[aria-pressed]").length).toBe(2); // 내/팀 칸반 세그만
    expect(select.classList.contains("h-11")).toBe(true); // 누르는 영역 44px — sm 이상에서도 상자(40px) 밖으로 넘쳐 유지
    const box = select.closest("label")!;
    expect(box.classList.contains("h-11")).toBe(true);
    expect(box.classList.contains("sm:h-10")).toBe(true); // 데스크톱: 칸반 세그와 같은 높이
    expect(box.classList.contains("max-sm:w-full")).toBe(true);
    expect(select.classList.contains("truncate")).toBe(true);
  });

  it("boardRoundOptions: 라벨 없는 회차는 제목만, 보관된 회차는 · 보관됨", () => {
    const [r] = tree.roots;
    const opts = boardRoundOptions([{ ...r, label: null, archived: true }], REF_DAY);
    expect(opts[1]).toEqual([r.id, `${r.title} (${md(r.s)} – ${md(r.e)}) · 보관됨`]);
  });
});
