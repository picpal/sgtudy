import { describe, expect, it } from "vitest";
import type { FileMeta } from "@/lib/api/types";
import { fileBadge, nodeObjectKey, nodeRemovePlan, nodeRows, sameIds } from "./nodeFiles";
import type { UploadRow } from "./uploads";

const meta = (id: string): FileMeta => ({ id, name: `${id}.pdf`, contentType: "application/pdf", size: 4, status: "ready" });
const up = (key: string, status: UploadRow["status"] = "uploading"): UploadRow => ({ key, fileId: key, name: `${key}.png`, size: 1, status, progress: 10 });

describe("nodeObjectKey — 0030 node_doc_key_ok 와 같은 모양", () => {
  const u = "0b9c2f6e-1d2a-4c3b-9e8f-112233445566";
  it("소문자 확장자", () => expect(nodeObjectKey("7", "21", u, "자료.PDF")).toBe(`n/7/21/${u}.pdf`));
  it("확장자 없음", () => expect(nodeObjectKey("7", "21", u, "README")).toBe(`n/7/21/${u}`));
  it("마지막 점 뒤만", () => expect(nodeObjectKey("7", "21", u, "a.tar.gz")).toBe(`n/7/21/${u}.gz`));
});

describe("nodeRows — 선택 id 가 진실 (Review Focus 6)", () => {
  const metas = new Map([["a", meta("a")], ["b", meta("b")], ["c", meta("c")]]);
  it("선택 순서대로 ready 줄 + 올리는 중 줄은 뒤에", () => {
    const rows = nodeRows(["b", "a"], metas, [up("k1")]);
    expect(rows.map((r) => [r.fileId, r.status])).toEqual([["b", "ready"], ["a", "ready"], ["k1", "uploading"]]);
  });
  it("ov 가 지워지면(저장본 선택) 새로 올린 c 는 사라진다", () => {
    expect(nodeRows(["a"], metas, []).map((r) => r.fileId)).toEqual(["a"]);
  });
  it("메타 없는 id 는 건너뛴다", () => expect(nodeRows(["zz"], metas, [])).toEqual([]));
});

describe("nodeRemovePlan", () => {
  const saved = new Set(["a"]);
  it("올리는 중 → abort", () => expect(nodeRemovePlan(up("k"), saved)).toBe("abort"));
  it("실패 줄 → drop", () => expect(nodeRemovePlan(up("k", "error"), saved)).toBe("drop"));
  it("저장된 파일 → drop(다음 저장이 DELETED)", () => expect(nodeRemovePlan({ ...up("a", "ready"), fileId: "a" }, saved)).toBe("drop"));
  it("미저장 ready → discard", () => expect(nodeRemovePlan({ ...up("c", "ready"), fileId: "c" }, saved)).toBe("discard"));
});

it("sameIds 는 순서까지 본다", () => {
  expect(sameIds(["a", "b"], ["a", "b"])).toBe(true);
  expect(sameIds(["a", "b"], ["b", "a"])).toBe(false);
});
it("fileBadge", () => {
  expect(["application/pdf", "application/zip", "application/x-zip-compressed", "image/png", "text/markdown"].map(fileBadge)).toEqual(["PDF", "ZIP", "ZIP", "IMG", "TXT"]);
});
