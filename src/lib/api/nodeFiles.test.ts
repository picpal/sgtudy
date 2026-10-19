import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import { discardNodeFile, discardNodeUnattached, fetchNodeFiles, fetchNodeFilesOrEmpty, registerNodeFile, setNodeFiles } from "./nodeFiles";

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
