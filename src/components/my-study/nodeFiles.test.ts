import { describe, expect, it } from "vitest";
import type { FileMeta } from "@/lib/api/types";
import { ACCEPT } from "./submission";
import { checkNodeFile, fileBadge, NODE_ACCEPT, NODE_FILE_HINT, nodeMimeOf, nodeObjectKey, nodeRemovePlan, nodeRows, sameIds, saveSteps } from "./nodeFiles";
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

describe("saveSteps — 저장 순서 (node_files_set 먼저)", () => {
  it("saveSteps: files first, then node; empty both → []", () => {
    expect(saveSteps(false, ["a"])).toEqual(["files", "node"]);
    expect(saveSteps(true, ["a"])).toEqual(["files"]);
    expect(saveSteps(false, undefined)).toEqual(["node"]);
    expect(saveSteps(true, undefined)).toEqual([]);
  });
});

describe("checkNodeFile — 종류별 한도·SVG (0045 D18·D19)", () => {
  const row = (name: string, contentType?: string): UploadRow =>
    ({ key: name, fileId: name, name, size: 1, status: contentType ? "ready" : "uploading", progress: 0, ...(contentType ? { meta: { id: name, name, contentType, size: 1, status: "ready" } } : {}) });
  const imgs = (n: number) => Array.from({ length: n }, (_, i) => row(`g${i}.svg`, "image/svg+xml"));
  const docs = (n: number) => Array.from({ length: n }, (_, i) => row(`d${i}.pdf`, "application/pdf"));
  const f = (name: string, type: string, size = 10) => ({ name, type, size });
  it("그림 20 + 문서 5 는 서로 자리를 먹지 않는다", () => {
    expect(checkNodeFile(f("a.png", "image/png"), [...imgs(19), ...docs(5)])).toEqual({ ok: true, mime: "image/png" });
    expect(checkNodeFile(f("a.pdf", "application/pdf"), [...imgs(20), ...docs(4)])).toEqual({ ok: true, mime: "application/pdf" });
  });
  it("21번째 그림 · 6번째 문서는 각 문구", () => {
    expect(checkNodeFile(f("a.png", "image/png"), imgs(20))).toEqual({ ok: false, error: "그림은 항목당 20개까지예요" });
    expect(checkNodeFile(f("a.pdf", "application/pdf"), docs(5))).toEqual({ ok: false, error: "파일은 항목당 5개까지예요" });
  });
  it("올리는 중 줄은 이름 확장자로 종류를 센다", () => {
    const up20 = Array.from({ length: 20 }, (_, i) => row(`u${i}.webp`));
    expect(checkNodeFile(f("a.png", "image/png"), up20).ok).toBe(false);
    expect(checkNodeFile(f("a.pdf", "application/pdf"), up20).ok).toBe(true);
  });
  it("SVG: type 또는 .svg 확장자로 알아보고 2MB 넘으면 거절", () => {
    expect(nodeMimeOf(f("a.svg", ""))).toBe("image/svg+xml");
    expect(nodeMimeOf(f("a.svg", "image/svg+xml"))).toBe("image/svg+xml");
    expect(checkNodeFile(f("a.svg", "image/svg+xml", 2_097_152), []).ok).toBe(true);
    expect(checkNodeFile(f("a.svg", "image/svg+xml", 2_097_153), [])).toEqual({ ok: false, error: "SVG 는 2MB까지예요" });
    expect(checkNodeFile(f("a.exe", "application/x-msdownload"), [])).toEqual({ ok: false, error: "올릴 수 없는 형식이에요" });
  });
  it("accept·안내: 노드 첨부만 SVG — 제출 ACCEPT 는 그대로", () => {
    expect(NODE_ACCEPT).toContain("image/svg+xml");
    expect(NODE_ACCEPT).toContain(".svg");
    expect(ACCEPT).not.toContain("svg");
    expect(NODE_FILE_HINT).toBe("그림(PNG·JPG·GIF·WEBP·SVG) 20개 · 파일(PDF·ZIP·TXT·MD) 5개 · 파일당 10MB(SVG 2MB)");
  });
});
