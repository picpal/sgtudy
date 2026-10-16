import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import { discardFile, fetchTask, fileUrl, registerFile, roomIdOfNode, upsertSubmission } from "./submission";

type Call = [string, unknown];
const fake = (opts: { rpc?: unknown; row?: unknown; signed?: string } = {}) => {
  const calls: Call[] = [];
  const q = {
    select: (c: string) => { calls.push(["select", c]); return q; },
    eq: (k: string, v: unknown) => { calls.push(["eq", [k, v]]); return q; },
    single: () => Promise.resolve({ data: opts.row ?? null, error: null }),
  };
  const client = {
    rpc: (name: string, args: unknown) => { calls.push([name, args]); return Promise.resolve({ data: opts.rpc ?? {}, error: null }); },
    from: (t: string) => { calls.push(["from", t]); return q; },
    storage: { from: (b: string) => ({ createSignedUrl: (p: string, s: number, o: unknown) => { calls.push(["sign", [b, p, s, o]]); return Promise.resolve({ data: { signedUrl: opts.signed ?? "https://x/s" }, error: null }); } }) },
  } as unknown as Db;
  return { calls, client };
};

describe("submission adapter", () => {
  it("fetchTask → task_get(p_slug, p_node:number)", async () => {
    const f = fake({ rpc: { today: "2026-10-12" } });
    expect(await fetchTask("aws", "21", f.client)).toEqual({ today: "2026-10-12" });
    expect(f.calls).toEqual([["task_get", { p_slug: "aws", p_node: 21 }]]);
  });
  it("upsertSubmission sends body, links, fileIds", async () => {
    const f = fake();
    await upsertSubmission("21", { body: "b", links: ["https://a"], fileIds: ["f1"] }, f.client);
    expect(f.calls).toEqual([["submission_upsert", { p_node: 21, p_body: "b", p_links: ["https://a"], p_file_ids: ["f1"] }]]);
  });
  it("registerFile → file_register", async () => {
    const f = fake();
    await registerFile("21", { path: "1/21/u/x.png", name: "노트.png", mime: "image/png", size: 4 }, f.client);
    expect(f.calls).toEqual([["file_register", { p_node: 21, p_path: "1/21/u/x.png", p_name: "노트.png", p_mime: "image/png", p_size: 4 }]]);
  });
  it("discardFile → file_discard (0015)", async () => {
    const f = fake();
    await discardFile("f1", f.client);
    expect(f.calls).toEqual([["file_discard", { p_file: "f1" }]]);
  });
  it("roomIdOfNode reads goal_nodes.room_id under RLS", async () => {
    const f = fake({ row: { room_id: 7 } });
    expect(await roomIdOfNode("21", f.client)).toBe("7");
    expect(f.calls).toEqual([["from", "goal_nodes"], ["select", "room_id"], ["eq", ["id", 21]]]);
  });
  it("fileUrl reads object_path then signs for 300s as a download with the original name", async () => {
    const f = fake({ row: { object_path: "1/21/u/x.png" }, signed: "https://signed" });
    expect(await fileUrl({ id: "f1", name: "노트.png" }, f.client)).toBe("https://signed");
    expect(f.calls.at(-1)).toEqual(["sign", ["attachments", "1/21/u/x.png", 300, { download: "노트.png" }]]);
  });
});
