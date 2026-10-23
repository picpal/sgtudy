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

describe("parseInline 그림 (D1~D3)", () => {
  const img = (alt: string, src: object) => ({ t: "img", alt, src });
  it("attachment: 는 그 노드의 첨부 이름", () => expect(parseInline("![구성도](attachment:vpc.svg)")).toEqual([img("구성도", { kind: "attachment", name: "vpc.svg" })]));
  it("이름은 퍼센트 디코딩, 잘못된 % 는 원문 그대로", () => {
    expect(parseInline("![](attachment:AWS%20VPC%20(1).png)")[0]).toEqual(img("", { kind: "attachment", name: "AWS VPC (1" }));
    expect(parseInline("![](attachment:AWS%20VPC%20%281%29.png)")).toEqual([img("", { kind: "attachment", name: "AWS VPC (1).png" })]);
    expect(parseInline("![x](attachment:a%zz.png)")).toEqual([img("x", { kind: "attachment", name: "a%zz.png" })]);
  });
  it("빈 alt 도 그림", () => expect(parseInline("![](attachment:a.png)")).toEqual([img("", { kind: "attachment", name: "a.png" })]));
  it("http(s) 는 external — 불러오지 않는 쪽은 렌더러가 정한다", () => {
    expect(parseInline("![x](https://a.io/p.png)")).toEqual([img("x", { kind: "external", href: "https://a.io/p.png" })]);
  });
  it("javascript:·data:·빈 이름 등 그 밖은 원문 글자", () => {
    for (const s of ["![x](javascript:alert(1))", "![x](data:image/png;base64,AAAA)", "![x](attachment:)", "![x](/local.png)", "![x](ftp://a/b.png)"]) {
      expect(parseInline(s)).toEqual([{ t: "text", v: s }]);
    }
  });
  it("! 가 링크보다 먼저 — 앞뒤 글자·서식과 함께", () => {
    expect(parseInline("앞![a](attachment:x.png) **뒤**")).toEqual([
      { t: "text", v: "앞" }, img("a", { kind: "attachment", name: "x.png" }), { t: "text", v: " " }, { t: "b", v: "뒤" },
    ]);
    expect(parseInline("! [a](https://a.io)")).toEqual([{ t: "text", v: "! " }, { t: "a", v: "a", href: "https://a.io" }]);
  });
  it("alt 는 평문, 200자에서 자른다", () => {
    expect(parseInline("![**굵게**](attachment:a.png)")).toEqual([img("**굵게**", { kind: "attachment", name: "a.png" })]);
    const r = parseInline(`![${"가".repeat(250)}](attachment:a.png)`)[0] as { alt: string };
    expect(r.alt).toHaveLength(200);
  });
});
