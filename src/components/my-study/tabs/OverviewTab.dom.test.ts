// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
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
    expect(doc.querySelectorAll('a[href="/rooms/new-room/settings"]').length).toBe(2);
  });
  it("참가자: 안내만", () => {
    const doc = renderOverview({ ...emptyRoom, action: "joined" } as StudyRoom);
    expect(doc.textContent).toContain("아직 스터디 소개가 없어요");
    expect(doc.textContent).toContain("그룹장이 진행목표를 준비하고 있어요");
    expect(doc.querySelector('a[href="/rooms/new-room/settings"]')).toBeNull();
  });
  it("운영 규칙은 마크다운으로 — 굵게·링크", () => {
    const doc = renderOverview({ ...emptyRoom, rules: ["**굵게** 와 [문서](https://example.com)"] } as StudyRoom);
    expect(doc.querySelector("li strong")?.textContent).toBe("굵게");
    expect(doc.querySelector('li a[href="https://example.com"]')?.textContent).toBe("문서");
  });
});
