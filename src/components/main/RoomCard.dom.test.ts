// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoomCard } from "./RoomCard";
import { DEFAULT_FILTERS, type HomeFilters } from "./homeUrl";
import { ROOMS } from "@/data/rooms";
import { routes } from "@/lib/routes";

const base = ROOMS[0]; // approval 은 끈다 — 승인제 아이콘의 title="그룹장 승인제" 와 섞이지 않게
const html = (created: boolean, scope: HomeFilters["scope"]) =>
  renderToStaticMarkup(createElement(RoomCard, { room: { ...base, approval: false, created }, selectedTags: [], filters: { ...DEFAULT_FILTERS, scope } }));

describe("RoomCard 그룹장 배지 (참가한 스터디에 그룹장 방 포함, 0029)", () => {
  it("참가한·공개 스터디: 내가 그룹장인 방에만 '그룹장' 배지", () => {
    expect(html(true, "mine")).toContain("그룹장");
    expect(html(false, "mine")).not.toContain("그룹장");
    expect(html(true, "public")).toContain("그룹장");
  });
  it("만든 스터디 목록에는 배지를 달지 않는다(전부 그룹장 방)", () => {
    expect(html(true, "created")).not.toContain("그룹장");
  });
});

describe("RoomCard 내 방은 내 스터디로", () => {
  const render = (room: Partial<typeof base>, anonymous = false) => {
    const div = document.createElement("div");
    div.innerHTML = renderToStaticMarkup(createElement(RoomCard, { room: { ...base, approval: false, ...room }, selectedTags: [], anonymous, filters: { ...DEFAULT_FILTERS, q: "aws" } }));
    return div.querySelector("a")!;
  };
  it("참가중(ACTIVE)·그룹장 → 내 스터디, 행선지를 aria-label 로", () => {
    for (const room of [{ mine: true }, { mine: true, created: true }]) {
      const a = render(room);
      expect(a.getAttribute("href")).toBe(`/my-study/${base.id}`);
      expect(a.getAttribute("aria-label")).toBe(`${base.title} — 내 스터디로 이동`);
    }
    expect(render({ mine: true }).textContent).toContain("참가중");
  });
  it("비참가·승인 대기·이탈(mine 아님) → 필터를 실은 공개 방, 참가중 배지 없음", () => {
    const a = render({ mine: false });
    expect(a.getAttribute("href")).toBe(`/rooms/${base.id}?q=aws`);
    expect(a.hasAttribute("aria-label")).toBe(false);
    expect(a.textContent).not.toContain("참가중");
  });
  it("비로그인은 그대로 로그인 → 공개 방", () => {
    expect(render({ mine: true }, true).getAttribute("href")).toBe(routes.login(routes.room(base.id)));
  });
});

describe("RoomCard 추가 모집 배지 (0032)", () => {
  const withExtra = (extra?: "open" | "full") =>
    renderToStaticMarkup(createElement(RoomCard, { room: { ...base, approval: false, extra }, selectedTags: [] }));
  it("extra open → '추가 모집', full → '정원 마감'", () => {
    expect(withExtra("open")).toContain("추가 모집");
    expect(withExtra("open")).not.toContain("추가 모집 · 정원 마감");
    expect(withExtra("full")).toContain("추가 모집 · 정원 마감");
    expect(withExtra(undefined)).not.toContain("추가 모집");
  });
});
