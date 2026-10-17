import { describe, expect, it } from "vitest";
import { parseInline } from "./inline";

describe("parseInline 링크 (Q2-9)", () => {
  it("http(s) 주소가 있으면 링크", () => expect(parseInline("[문서](https://a.io/x)")).toEqual([{ t: "a", v: "문서", href: "https://a.io/x" }]));
  it("주소를 안 채운 에디터 자리 글자 [글](https://)·쓸 수 없는 주소는 링크 문법을 감추고 글자만", () => {
    expect(parseInline("앞 [링크 텍스트](https://) 뒤")).toEqual([{ t: "text", v: "앞 링크 텍스트 뒤" }]);
    expect(parseInline("[링크 텍스트](x링크)")).toEqual([{ t: "text", v: "링크 텍스트" }]);
    expect(parseInline("[빈]()")).toEqual([{ t: "text", v: "빈" }]);
  });
  it("javascript: 같은 주소는 링크로 만들지 않는다", () => expect(parseInline("[x](javascript:alert(1))")[0]).toMatchObject({ t: "text" }));
});
