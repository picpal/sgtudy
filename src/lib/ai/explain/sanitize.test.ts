import { describe, expect, it } from "vitest";
import { sanitizeExplain } from "./sanitize";
import type { ExplainOut } from "./schema";

const base: ExplainOut = { kind: "term", term: "CIDR 블록", oneLiner: "IP 범위", inContext: "- a", points: [], related: [] };

describe("sanitizeExplain", () => {
  it("strips links, html, headings, urls", () => {
    const r = sanitizeExplain({ ...base, oneLiner: "<b>IP</b> [범위](http://x.com) 예요 https://evil.com", inContext: "## 제목\n- [링크](http://a) 글\n![img](http://i)" }, "CIDR 블록");
    expect(r.oneLiner).toBe("IP 범위 예요");
    expect(r.inContext).not.toMatch(/http|#|\[|!/);
    expect(r.inContext).toContain("- 링크 글");
  });
  it("caps points at 4 and each 120cp", () => {
    const r = sanitizeExplain({ ...base, points: ["a", "b", "c", "d", "e", "가".repeat(200)] }, "CIDR 블록");
    expect(r.points).toEqual(["a", "b", "c", "d"]);
    const r2 = sanitizeExplain({ ...base, points: ["가".repeat(200)] }, "x");
    expect([...r2.points[0]].length).toBe(120);
  });
  it("related: removes empty, duplicates, the term itself, items over 30cp; ≤ 4", () => {
    const r = sanitizeExplain({ ...base, related: ["VPC", "vpc", "", "“CIDR 블록”", "서브넷", "IGW", "NAT", "라우팅"] }, "CIDR 블록");
    expect(r.related).toEqual(["VPC", "서브넷", "IGW", "NAT"]);
    // 30cp 넘는 관련 용어는 자르지 않고 뺀다(잘린 용어로 다시 물으면 엉뚱한 해설)
    const r2 = sanitizeExplain({ ...base, related: ["가".repeat(31), "AWS Certified Solutions Architect", "EC2", "나".repeat(30)] }, "x");
    expect(r2.related).toEqual(["EC2", "나".repeat(30)]);
  });
  it("not_term empties sections", () => {
    const r = sanitizeExplain({ ...base, kind: "not_term", points: ["a"], related: ["b"], inContext: "x" }, "문장이에요");
    expect(r).toEqual({ kind: "not_term", term: "CIDR 블록", oneLiner: "IP 범위", inContext: "", points: [], related: [] });
  });
  it("empty term falls back to the input term", () => {
    expect(sanitizeExplain({ ...base, term: " " }, "  듀얼 스택 ").term).toBe("듀얼 스택");
  });
});
