import { describe, expect, it } from "vitest";
import { emptyCopy } from "./empty-copy";

describe("emptyCopy", () => {
  it("spec priority without filters", () => {
    // 검색어만 걸린 빈 상태 — 검색어를 지우는 버튼이 먼저(Q3-5), 방 만들기는 보조
    expect(emptyCopy("aws", "public", "all", [])).toEqual({ title: "‘aws’ 검색 결과가 없어요", body: "다른 키워드나 태그로 다시 찾아보세요.", action: "clear" });
    expect(emptyCopy("", "created", "all", []).title).toBe("아직 만든 방이 없어요");
    expect(emptyCopy("", "public", "all", []).title).toBe("조건에 맞는 방이 없어요");
  });
  it("search + active tag/status filter names the filters and offers reset (Q3-15)", () => {
    expect(emptyCopy("aws", "public", "recruit", ["알고리즘"])).toEqual({
      title: "‘aws’ 검색 결과가 없어요",
      body: "모집중 · #알고리즘 필터가 함께 걸려 있어요. 필터를 풀고 다시 찾아보세요.",
      action: "reset",
    });
  });
  it("filters only → reset", () => {
    expect(emptyCopy("", "mine", "ended", [])).toEqual({ title: "조건에 맞는 방이 없어요", body: "종료 필터에 맞는 방이 없어요.", action: "reset" });
  });
  it("empty 내가 참가한 방 → browse CTA (Q3-16)", () => {
    expect(emptyCopy("", "mine", "all", [])).toEqual({ title: "참가한 방이 없어요", body: "마음에 드는 스터디를 찾아 참가해 보세요.", action: "browse" });
  });
});
