// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoomCard } from "./RoomCard";
import { DEFAULT_FILTERS, type HomeFilters } from "./homeUrl";
import { ROOMS } from "@/data/rooms";

const base = ROOMS[0]; // approval 은 끈다 — 승인제 아이콘의 title="그룹장 승인제" 와 섞이지 않게
const html = (created: boolean, scope: HomeFilters["scope"]) =>
  renderToStaticMarkup(createElement(RoomCard, { room: { ...base, approval: false, created }, selectedTags: [], filters: { ...DEFAULT_FILTERS, scope } }));

describe("RoomCard 그룹장 배지 (참가한 스터디에 그룹장 방 포함, 0029)", () => {
  it("참가한 스터디: 내가 그룹장인 방에만 '그룹장' 배지", () => {
    expect(html(true, "mine")).toContain("그룹장");
    expect(html(false, "mine")).not.toContain("그룹장");
  });
  it("공개·만든 스터디 목록에는 배지를 달지 않는다(만든 스터디는 전부 그룹장 방)", () => {
    expect(html(true, "public")).not.toContain("그룹장");
    expect(html(true, "created")).not.toContain("그룹장");
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
