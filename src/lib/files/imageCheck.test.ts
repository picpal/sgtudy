import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseInline } from "@/lib/markdown/inline";
import { imageKindLabel, imageSnippet, sniffImage, svgProblems } from "./imageCheck";

const bytes = (...v: number[]) => new Uint8Array([...v, ...new Array(20).fill(0)]);
const text = (s: string) => new TextEncoder().encode(s);
const fixture = (n: string) => readFileSync(path.join(__dirname, "__fixtures__", n), "utf8");

describe("sniffImage — 매직바이트 (D27)", () => {
  it("래스터 4종", () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImage(text("GIF89a\x01\x00"))).toBe("image/gif");
    expect(sniffImage(text("GIF87a\x01\x00"))).toBe("image/gif");
    expect(sniffImage(text("RIFF\x24\x00\x00\x00WEBPVP8 "))).toBe("image/webp");
  });
  it("SVG — BOM·공백·<?xml?>·주석·DOCTYPE 뒤 <svg", () => {
    expect(sniffImage(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("image/svg+xml");
    expect(sniffImage(text('﻿\n  <?xml version="1.0"?>\n<!-- hi -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg>'))).toBe("image/svg+xml");
    for (const n of ["drawio.svg", "excalidraw.svg", "mermaid.svg"]) expect(sniffImage(text(fixture(n)))).toBe("image/svg+xml");
  });
  it("위장 — HTML·ZIP·PDF·빈 파일·짧은 RIFF 는 null", () => {
    expect(sniffImage(text("<!doctype html><html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(text("<html><svg></svg></html>"))).toBeNull();
    expect(sniffImage(bytes(0x50, 0x4b, 0x03, 0x04))).toBeNull();
    expect(sniffImage(text("%PDF-1.7"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
    expect(sniffImage(text("RIFF\x24\x00\x00\x00WAVE"))).toBeNull();
    expect(sniffImage(text("<svgx>"))).toBeNull();
  });
  it("형식 이름", () => {
    expect(imageKindLabel("image/jpeg")).toBe("JPG");
    expect(imageKindLabel("image/svg+xml")).toBe("SVG");
  });
});

describe("svgProblems — 금지 패턴", () => {
  it("그림 편집기 출력(draw.io·Excalidraw·mermaid)은 통과", () => {
    for (const n of ["drawio.svg", "excalidraw.svg", "mermaid.svg"]) expect(svgProblems(fixture(n)), n).toEqual([]);
  });
  const bad: [string, string, RegExp][] = [
    ["script", '<svg><script>alert(1)</script></svg>', /<script>/],
    ["script 대문자·접두", '<svg><SVG:SCRIPT href="x"/></svg>', /<script>/],
    ["이벤트 속성", '<svg onload="alert(1)"/>', /on…=/],
    ["이벤트 속성 공백·대문자", '<svg><rect ONCLICK = "x"/></svg>', /on…=/],
    ["javascript:", '<svg><a href="javascript:alert(1)">x</a></svg>', /javascript:/],
    ["javascript: 엔티티", '<svg><a href="&#106;avascript:alert(1)">x</a></svg>', /javascript:/],
    ["iframe", '<svg><foreignObject><iframe src="https://x"/></foreignObject></svg>', /<iframe>/],
    ["embed·object", '<svg><embed/><object/></svg>', /<iframe>/],
    ["meta refresh", '<svg><foreignObject><meta http-equiv="refresh" content="0;url=https://x"/></foreignObject></svg>', /<iframe>/],
    ["ENTITY", '<!DOCTYPE svg [<!ENTITY a "aaaa">]><svg>&a;</svg>', /ENTITY/],
    ["내부 DTD", '<!DOCTYPE svg [ ]><svg/>', /내부 DTD/],
    ["xlink:href data:svg", '<svg><image xlink:href="data:image/svg+xml;base64,PHN2Zz4="/></svg>', /href/],
    ["image 외부", '<svg><image href="https://tracker.example/p.png"/></svg>', /href/],
    ["use 외부", '<svg><use href="other.svg#a"/></svg>', /href/],
    ["@import", '<svg><style>@import url(https://x/a.css);</style></svg>', /@import/],
    ["css url 외부", '<svg><rect style="fill:url(https://x/p.png)"/></svg>', /url\(\)/],
    ["src 외부", '<svg><foreignObject><img src="https://x/p.png"/></foreignObject></svg>', /\(src\)/],
    ["href 애니메이션", '<svg><a><set attributeName="href" to="#x"/></a></svg>', /attributeName/],
  ];
  it.each(bad)("%s → 거부", (_, svg, rule) => {
    const p = svgProblems(svg);
    expect(p.length).toBeGreaterThan(0);
    expect(p.join(" ")).toMatch(rule);
  });
  it("같은 규칙은 한 번만", () => expect(svgProblems('<svg onload="a" onclick="b"/>')).toEqual(["SVG 에 이벤트 속성이 있어요(on…=)"]));
  it("글자 속 'one =' 은 이벤트 속성이 아니다", () => expect(svgProblems("<svg><text>phone one = 1</text></svg>")).toEqual([]));
});

describe("imageSnippet", () => {
  it("그대로 쓸 수 있는 이름은 그대로(한글 포함)", () => expect(imageSnippet("3주차-VPC구성.svg")).toBe("![](attachment:3주차-VPC구성.svg)"));
  it("공백·괄호·% 만 인코딩 — 파서가 같은 이름으로 되읽는다", () => {
    for (const name of ["AWS VPC (1).png", "100%.png", "a\tb.png", "x)y.png"]) {
      const s = imageSnippet(name, "대체 [글]");
      const t = parseInline(s);
      expect(t).toEqual([{ t: "img", alt: "대체 글", src: { kind: "attachment", name } }]);
    }
    expect(imageSnippet("AWS VPC (1).png")).toBe("![](attachment:AWS%20VPC%20%281%29.png)");
  });
});
