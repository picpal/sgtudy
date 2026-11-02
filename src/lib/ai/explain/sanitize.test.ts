import { describe, expect, it } from "vitest";
import { sanitizeExplain, stripAnswerHints, TAKE_FALLBACK } from "./sanitize";
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

describe("stripAnswerHints (응시 화면 exam_take, 0055)", () => {
  it("drops sentences pointing at a choice or the answer · keeps concept sentences", () => {
    const r = stripAnswerHints({
      ...base,
      oneLiner: "IP 주소 범위를 적는 방식이에요. 그래서 정답은 2번이에요",
      inContext: "- 서브넷을 나눌 때 써요\n- 이 문제에서는 ③이 맞아요\n- 보기 1은 틀려요. 접두사 길이가 범위를 정해요\n- 답은 B 예요",
      points: ["/16 ~ /28 범위를 기억해요", "2번 보기가 옳아요", "오답은 4번이에요", "맞는 선택지는 첫째예요"],
      related: ["서브넷", "정답 2번"],
    });
    expect(r.oneLiner).toBe("IP 주소 범위를 적는 방식이에요.");
    expect(r.inContext).toBe("- 서브넷을 나눌 때 써요\n- 접두사 길이가 범위를 정해요");
    expect(r.points).toEqual(["/16 ~ /28 범위를 기억해요"]);
    expect(r.related).toEqual(["서브넷"]);
  });
  it("keeps ordinary numbers and words (2번 이상 · 대답 · 답변)", () => {
    const keep = { ...base, oneLiner: "요청을 2번 이상 보내도 결과가 같아요", inContext: "- 대답이 늦으면 재시도해요\n- 답변 시간을 줄여요", points: ["/16 은 65,536개예요"] };
    expect(stripAnswerHints(keep)).toEqual(keep);
  });
  it("oneLiner fully dropped → fallback line · not_term too", () => {
    expect(stripAnswerHints({ ...base, oneLiner: "정답은 ①이에요" }).oneLiner).toBe(TAKE_FALLBACK);
    expect(stripAnswerHints({ ...base, kind: "not_term", oneLiner: "보기 3이 맞아요", inContext: "" }).oneLiner).toBe(TAKE_FALLBACK);
  });
});
