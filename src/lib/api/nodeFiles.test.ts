import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import { discardNodeFile, discardNodeUnattached, fetchNodeFiles, fetchNodeFilesOrEmpty, nodeImageUrls, registerNodeFile, setNodeFiles, setNodeFilesFrom } from "./nodeFiles";

const fake = (data: unknown = {}, error: unknown = null) => {
  const calls: [string, unknown][] = [];
  const client = { rpc: (n: string, a: unknown) => { calls.push([n, a]); return Promise.resolve({ data: error ? null : data, error }); } } as unknown as Db;
  return { calls, client };
};
const P0001 = (code: string) => ({ code: "P0001", message: code, details: "m", hint: "{}" });

describe("nodeFiles adapter (0030)", () => {
  it("registerNodeFile → node_file_register(p_node:number, …)", async () => {
    const f = fake();
    await registerNodeFile("21", { path: "n/1/21/x.pdf", name: "자료.pdf", mime: "application/pdf", size: 9 }, f.client);
    expect(f.calls).toEqual([["node_file_register", { p_node: 21, p_path: "n/1/21/x.pdf", p_name: "자료.pdf", p_mime: "application/pdf", p_size: 9 }]]);
  });
  it("setNodeFiles → node_files_set keeps order", async () => {
    const f = fake([]);
    await setNodeFiles("21", ["b", "a"], f.client);
    expect(f.calls).toEqual([["node_files_set", { p_node: 21, p_file_ids: ["b", "a"] }]]);
  });
  it("setNodeFilesFrom → node_files_set 3인자(p_base, 0045 D30)", async () => {
    const f = fake([]);
    await setNodeFilesFrom("21", ["b"], ["a", "b"], f.client);
    expect(f.calls).toEqual([["node_files_set", { p_node: 21, p_file_ids: ["b"], p_base: ["a", "b"] }]]);
  });
  it("fetchNodeFiles → node_files", async () => {
    const f = fake([{ id: "a" }]);
    expect(await fetchNodeFiles("21", f.client)).toEqual([{ id: "a" }]);
    expect(f.calls).toEqual([["node_files", { p_node: 21 }]]);
  });
  it("discardNodeFile → node_file_discard", async () => {
    const f = fake({ id: "a", status: "deleted" });
    await discardNodeFile("a", f.client);
    expect(f.calls).toEqual([["node_file_discard", { p_file: "a" }]]);
  });
  it("discardNodeUnattached never throws", async () => {
    expect(await discardNodeUnattached("a", fake({ id: "a", status: "deleted" }).client)).toBe(true);
    expect(await discardNodeUnattached("a", fake(null, P0001("FILE_ATTACHED")).client)).toBe(false);
  });
  it("fetchNodeFilesOrEmpty: NODE_NOT_FOUND → [], other errors throw", async () => {
    expect(await fetchNodeFilesOrEmpty("21", fake(null, P0001("NODE_NOT_FOUND")).client)).toEqual([]);
    await expect(fetchNodeFilesOrEmpty("21", fake(null, P0001("UNKNOWN")).client)).rejects.toBeTruthy();
  });
});

describe("nodeImageUrls (md-images D14)", () => {
  const client = (rows: { id: string; object_path: string }[], signed: { path: string | null; signedUrl: string; error: string | null }[]) => {
    const calls: unknown[] = [];
    const c = {
      from: (t: string) => ({ select: (cols: string) => ({ in: (col: string, ids: string[]) => { calls.push(["from", t, cols, col, ids]); return Promise.resolve({ data: rows, error: null }); } }) }),
      storage: { from: (b: string) => ({ createSignedUrls: (paths: string[], sec: number, opt?: unknown) => { calls.push(["sign", b, paths, sec, opt]); return Promise.resolve({ data: signed, error: null }); } }) },
    } as unknown as Db;
    return { c, calls };
  };
  it("경로를 한 번에 받아 1시간 inline 서명(download 없음) 한 번, 실패한 것은 빠진다", async () => {
    const { c, calls } = client(
      [{ id: "a", object_path: "n/1/2/a.png" }, { id: "b", object_path: "n/1/2/b.svg" }],
      [{ path: "n/1/2/a.png", signedUrl: "https://s/a", error: null }, { path: "n/1/2/b.svg", signedUrl: "", error: "Object not found" }],
    );
    const m = await nodeImageUrls([{ id: "a" }, { id: "b" }], c);
    expect([...m]).toEqual([["a", "https://s/a"]]);
    expect(calls).toEqual([["from", "files", "id, object_path", "id", ["a", "b"]], ["sign", "attachments", ["n/1/2/a.png", "n/1/2/b.svg"], 3600, undefined]]);
  });
  it("빈 목록은 부르지 않는다", async () => {
    const { c, calls } = client([], []);
    expect((await nodeImageUrls([], c)).size).toBe(0);
    expect(calls).toEqual([]);
  });
});
