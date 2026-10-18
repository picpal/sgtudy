import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, filtersNote, homeHref, parseHomeFilters, roomHrefWith, sameFilters, urlStep, type HomeFilters } from "./homeUrl";

const D: HomeFilters = { scope: "public", status: "all", q: "", tags: [] };

describe("parseHomeFilters", () => {
  it("빈 주소 → 기본값", () => {
    expect(parseHomeFilters(new URLSearchParams(""))).toEqual(D);
    expect(parseHomeFilters({})).toEqual(D);
  });
  it("tab·status·q·tag(반복) 를 읽는다", () => {
    expect(parseHomeFilters(new URLSearchParams("tab=mine&status=recruit&q=%20aws%20&tag=aws&tag=cloud"))).toEqual({ scope: "mine", status: "recruit", q: "aws", tags: ["aws", "cloud"] });
  });
  it("서버 컴포넌트 searchParams 객체(문자열|배열)도 받는다", () => {
    expect(parseHomeFilters({ tab: "created", tag: ["a", "b"], q: ["x", "y"] })).toEqual({ scope: "created", status: "all", q: "x", tags: ["a", "b"] });
    expect(parseHomeFilters({ tag: "a" })).toEqual({ ...D, tags: ["a"] });
  });
  it("모르는 값은 기본값, 태그는 중복·빈 값 제거 후 10개까지, 검색어는 50자까지", () => {
    expect(parseHomeFilters(new URLSearchParams("tab=evil&status=x&tag=&tag=a&tag=a"))).toEqual({ ...D, tags: ["a"] });
    const many = Array.from({ length: 15 }, (_, i) => `tag=t${i}`).join("&");
    expect(parseHomeFilters(new URLSearchParams(many)).tags).toHaveLength(10);
    expect(parseHomeFilters(new URLSearchParams(`q=${"가".repeat(80)}`)).q).toHaveLength(50);
  });
});

describe("homeHref", () => {
  it("기본값은 주소에서 뺀다", () => {
    expect(homeHref(D)).toBe("/");
  });
  it("tab → status → q → tag 순, 한글은 인코딩", () => {
    expect(homeHref({ scope: "mine", status: "active", q: "스프링", tags: ["aws", "클라우드"] })).toBe("/?tab=mine&status=active&q=%EC%8A%A4%ED%94%84%EB%A7%81&tag=aws&tag=%ED%81%B4%EB%9D%BC%EC%9A%B0%EB%93%9C");
  });
  it("왕복해도 같다", () => {
    const f: HomeFilters = { scope: "created", status: "ended", q: "a b&c", tags: ["x"] };
    expect(parseHomeFilters(new URLSearchParams(homeHref(f).slice(2)))).toEqual(f);
  });
});

describe("sameFilters", () => {
  it("태그 순서까지 같아야 같다", () => {
    expect(sameFilters(D, { ...D })).toBe(true);
    expect(sameFilters({ ...D, tags: ["a", "b"] }, { ...D, tags: ["b", "a"] })).toBe(false);
  });
});

describe("urlStep", () => {
  it("같으면 none, 검색어만 바뀌면 replace(타이핑마다 기록이 쌓이지 않게), 그 외는 push", () => {
    expect(urlStep(D, { ...D })).toBe("none");
    expect(urlStep(D, { ...D, q: "aws" })).toBe("replace");
    expect(urlStep(D, { ...D, scope: "mine" })).toBe("push");
    expect(urlStep(D, { ...D, q: "a", tags: ["x"] })).toBe("push");
  });
});

describe("roomHrefWith / filtersNote — 방 상세 왼쪽 목록이 둘러보기 필터를 이어받는다 (시나리오 QA #19)", () => {
  const f = { scope: "public" as const, status: "recruit" as const, q: "코딩", tags: ["algo"] };
  it("방 주소에 둘러보기 필터를 그대로 붙인다(기본값은 뺀다)", () => {
    expect(roomHrefWith("algo-8", f)).toBe("/rooms/algo-8?status=recruit&q=%EC%BD%94%EB%94%A9&tag=algo");
    expect(roomHrefWith("algo-8", DEFAULT_FILTERS)).toBe("/rooms/algo-8");
  });
  it("방 상세 주소에서 다시 읽으면 같은 필터 (invite 등 다른 키는 무시)", () => {
    expect(parseHomeFilters(new URLSearchParams("status=recruit&q=코딩&tag=algo&invite=x"))).toEqual(f);
  });
  it("검색어·태그가 있을 때만 안내 문구", () => {
    expect(filtersNote(DEFAULT_FILTERS, [])).toBeNull();
    expect(filtersNote({ ...DEFAULT_FILTERS, status: "recruit" }, [])).toBeNull();
    expect(filtersNote(f, ["알고리즘"])).toBe("‘코딩’ · #알고리즘 로 거른 목록");
    expect(filtersNote({ ...f, q: "" }, ["알고리즘", "CS"])).toBe("#알고리즘 #CS 로 거른 목록");
  });
});
