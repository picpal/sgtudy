import { describe, expect, it } from "vitest";
import { ExplainOut, ExplainRequest } from "./schema";

const req = { slug: "aws", term: "CIDR", source: "node", context: "" };

describe("ExplainRequest", () => {
  it("accepts a valid request", () => {
    expect(ExplainRequest.safeParse(req).success).toBe(true);
  });
  it("rejects unknown source and too-long context/term", () => {
    expect(ExplainRequest.safeParse({ ...req, source: "comment" }).success).toBe(false);
    expect(ExplainRequest.safeParse({ ...req, context: "x".repeat(1201) }).success).toBe(false);
    expect(ExplainRequest.safeParse({ ...req, term: "x".repeat(201) }).success).toBe(false);
    expect(ExplainRequest.safeParse({ ...req, slug: "" }).success).toBe(false);
  });
});

describe("ExplainOut", () => {
  const out = { kind: "term", term: "a", oneLiner: "b", inContext: "c", points: [], related: [] };
  it("strict: rejects extra keys and missing keys", () => {
    expect(ExplainOut.safeParse(out).success).toBe(true);
    expect(ExplainOut.safeParse({ ...out, answer: 1 }).success).toBe(false);
    const { related: _r, ...missing } = out;
    void _r;
    expect(ExplainOut.safeParse(missing).success).toBe(false);
    expect(ExplainOut.safeParse({ ...out, kind: "other" }).success).toBe(false);
  });
});
