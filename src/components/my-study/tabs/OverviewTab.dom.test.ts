// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MyPersonalLine, OverviewTab } from "./OverviewTab";
import type { StudyRoom } from "@/lib/api/my-study";
import { EMPTY_OVERRIDES, buildTree } from "../model";
import { AWS, CHULSU, JIEUN, REF_DAY } from "../fixtures";

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const render = (userId: string, roundId: string) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(MyPersonalLine, { tree, userId, roundId, slug: "aws" }));
  return root;
};

describe("OverviewTab 내 카드 개인 목표 줄", () => {
  it("이번 회차 d/t 완료 · 내 과제(/tasks?study=slug) 링크", () => {
    const doc = render(JIEUN, "3");
    expect(doc.textContent).toContain("개인 목표 이번 회차 1/1 완료");
    expect(doc.querySelector("a")?.getAttribute("href")).toBe("/tasks?study=aws");
    expect(render(CHULSU, "3").textContent).toContain("0/1 완료");
  });
  it("그 회차에 없으면 안내 문구", () => {
    expect(render(JIEUN, "2").textContent).toContain("이번 회차 개인 목표가 아직 없어요");
  });
});

// Q2-11: 소개·규칙·회차가 없는 방 — 제목만 덩그러니 두지 않고 빈 상태 안내(그룹장은 어디서 채우는지까지)
const emptyRoom = {
  id: "new-room", title: "새 방", intro: "소개", status: "recruit", draft: true, period: "", dday: "", ddayLong: "", joinMode: "바로 참가", visibility: "공개",
  leader: "민수", tags: [], capCur: 1, capMax: 5, minText: "", minOk: true, members: [],
  cur: { pill: "시작 전", title: "첫 회차", meta: "", tasks: [] }, about: "", rules: [], rounds: [], moreRounds: "", action: "owner", next: null,
} as unknown as StudyRoom;
const renderOverview = (room: StudyRoom) => {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(createElement(OverviewTab, { room, tree, roundId: null, onGoCurriculum: () => {} }));
  return root;
};

describe("OverviewTab 빈 상태 (Q2-11)", () => {
  it("그룹장: 소개·규칙은 방 설정에서, 일정은 진행목표에서", () => {
    const doc = renderOverview(emptyRoom);
    expect(doc.textContent).toContain("아직 스터디 소개가 없어요");
    expect(doc.textContent).toContain("아직 운영 규칙이 없어요");
    expect(doc.textContent).toContain("아직 회차가 없어요");
    expect(doc.querySelectorAll('a[href="/rooms/new-room/settings?from=%2Fmy-study%2Fnew-room"]').length).toBe(2);
  });
  it("참가자: 안내만", () => {
    const doc = renderOverview({ ...emptyRoom, action: "joined" } as StudyRoom);
    expect(doc.textContent).toContain("아직 스터디 소개가 없어요");
    expect(doc.textContent).toContain("그룹장이 진행목표를 준비하고 있어요");
    expect(doc.querySelector('a[href^="/rooms/new-room/settings"]')).toBeNull();
  });
  it("운영 규칙은 마크다운으로 — 굵게·링크", () => {
    const doc = renderOverview({ ...emptyRoom, rules: ["**굵게** 와 [문서](https://example.com)"] } as StudyRoom);
    expect(doc.querySelector("li strong")?.textContent).toBe("굵게");
    expect(doc.querySelector('li a[href="https://example.com"]')?.textContent).toBe("문서");
  });
});

// 이번 회차 과제 카드 → 그 과제의 진행목표 보기 상세 (onOpenTask = MyStudyScreen 의 goLeaf)
describe("OverviewTab 이번 회차 과제 카드 누름", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const room = {
    ...emptyRoom, action: "joined", rounds: [],
    cur: { pill: "2주차 · 진행중", title: "EC2·S3", meta: "", tasks: [
      { id: "21", title: "EC2 인스턴스 유형 정리", type: "지정", dates: "10.08 – 10.14", people: [["지은", "done"], ["철수", "open"]] },
      { id: "22", title: "S3 스토리지 클래스 발표자료", type: "지정", dates: "10.10 – 10.14", people: [] },
    ] },
  } as unknown as StudyRoom;
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });
  const mount = (onOpenTask?: (id: string) => void) => {
    const host = document.body.appendChild(document.createElement("div"));
    const opened: string[] = [];
    const goCur = vi.fn();
    root = createRoot(host);
    act(() => root!.render(createElement(OverviewTab, { room, tree, roundId: null, onGoCurriculum: goCur, onOpenTask: onOpenTask ?? ((id: string) => opened.push(id)) })));
    const card = (title: string) => [...host.querySelectorAll("li")].find((li) => li.textContent?.includes(title))!;
    return { host, opened, goCur, card };
  };
  const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

  it("카드 어디를 눌러도(아바타·진행 막대 포함) 그 과제 id 로 연다", () => {
    const { opened, card } = mount();
    click(card("EC2").querySelector("[title]")!);
    click(card("S3").querySelector("div:last-child")!);
    expect(opened).toEqual(["21", "22"]);
  });
  it("키보드: 제목이 실제 버튼 — Enter·Space 가 내는 click 한 번에 한 번만 연다", () => {
    const { opened, card } = mount();
    const btn = card("EC2").querySelector("button")!;
    expect(btn.getAttribute("type")).toBe("button");
    expect(btn.textContent).toBe("EC2 인스턴스 유형 정리");
    act(() => btn.focus());
    expect(document.activeElement).toBe(btn);
    act(() => btn.click()); // 브라우저는 버튼에서 Enter 를 click 으로 바꾼다 — jsdom 은 이 기본 동작을 흉내 내지 않는다
    expect(opened).toEqual(["21"]);
    // 포커스 링은 카드(li) 전체에 — 버튼 자기 외곽선은 끈다
    expect(card("EC2").className).toContain("has-[button:focus-visible]:outline-2");
    expect(btn.className).toContain("focus-visible:outline-none");
  });
  it("5명 이상이면 3명 + '+N' 펼치기 버튼 — 눌러도 과제를 열지 않는다", () => {
    const five = { ...room, cur: { ...room.cur, tasks: [{ id: "23", title: "VPC 설계", type: "공통", dates: "10.08 – 10.14", people: ["지은", "철수", "영희", "민수", "수진"].map((n) => [n, "open"]) }] } } as unknown as StudyRoom;
    const opened: string[] = [];
    act(() => {
      root = createRoot(document.body.appendChild(document.createElement("div")));
      root.render(createElement(OverviewTab, { room: five, tree, roundId: null, onGoCurriculum: () => {}, onOpenTask: (id: string) => opened.push(id) }));
    });
    const toggle = document.querySelector<HTMLButtonElement>("li button[data-avatar-toggle]")!;
    expect(toggle.getAttribute("aria-label")).toBe("참가자 5명 모두 보기");
    expect(toggle.textContent).toContain("+2");
    click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(opened).toEqual([]);
  });
  it("카드 밖 '진행목표 전체 보기' 는 과제를 열지 않는다", () => {
    const { host, opened, goCur } = mount();
    click([...host.querySelectorAll("button")].find((b) => b.textContent === "진행목표 전체 보기")!);
    expect(goCur).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([]);
  });
  it("onOpenTask 가 없거나 id 가 없으면 누를 수 없는 카드(버튼 없음)", () => {
    act(() => {
      root = createRoot(document.body.appendChild(document.createElement("div")));
      root.render(createElement(OverviewTab, { room, tree, roundId: null, onGoCurriculum: () => {} }));
    });
    expect(document.querySelector("li button")).toBeNull();
  });
});
