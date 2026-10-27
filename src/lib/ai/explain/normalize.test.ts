import { describe, expect, it } from "vitest";
import { clipContext, isTermLength, normTerm } from "./normalize";

describe("normTerm", () => {
  it("trims quotes/punctuation, collapses spaces, lowercases", () => {
    expect(normTerm("  “CIDR  블록”, ")).toBe("cidr 블록");
    expect(normTerm("(듀얼 스택)")).toBe("듀얼 스택");
    expect(normTerm("VPC?")).toBe("vpc");
  });
  it("keeps balanced inner brackets", () => {
    expect(normTerm("AWS(Amazon)")).toBe("aws(amazon)");
    expect(normTerm("「AWS(Amazon)」.")).toBe("aws(amazon)");
  });
  it("applies NFKC", () => {
    expect(normTerm("ＡＷＳ")).toBe("aws");
  });
  it("clamps to 40 code points", () => {
    expect([...normTerm("가".repeat(41))].length).toBe(40);
  });
  it("strips control chars", () => {
    expect(normTerm("S3\u0000")).toBe("s3");
  });
});

describe("isTermLength", () => {
  it("1~40 cp after normalize, ≤1 line break", () => {
    expect(isTermLength("CIDR 블록")).toBe(true);
    expect(isTermLength("가".repeat(40))).toBe(true);
    expect(isTermLength("가".repeat(41))).toBe(false);
    expect(isTermLength("😀".repeat(40))).toBe(true);
    expect(isTermLength("😀".repeat(41))).toBe(false);
    expect(isTermLength("a\nb")).toBe(true);
    expect(isTermLength("a\nb\nc")).toBe(false);
    expect(isTermLength("  “”  ")).toBe(false);
    expect(isTermLength("")).toBe(false);
  });
});

describe("clipContext", () => {
  it("contains the term and is ≤ 300 cp", () => {
    const text = "가".repeat(500) + " CIDR 블록 " + "나".repeat(500);
    const c = clipContext(text, "CIDR 블록");
    expect(c).toContain("CIDR 블록");
    expect([...c].length).toBeLessThanOrEqual(300);
  });
  it("term near the end still included", () => {
    const text = "가".repeat(800) + " 끝용어";
    expect(clipContext(text, "끝용어")).toContain("끝용어");
  });
  it("no term → first 300 cp · short text untouched (spaces collapsed)", () => {
    expect([...clipContext("x".repeat(400), "없음")].length).toBe(300);
    expect(clipContext("a   b\n c", "b")).toBe("a b c");
  });
});
