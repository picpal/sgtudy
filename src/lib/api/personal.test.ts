import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import { fetchMyTasks, personalArchive, personalComplete, personalCreate, personalDelete, personalUpdate } from "./personal";

const fakeDb = () => {
  const calls: [string, Record<string, unknown>][] = [];
  const client = { rpc: (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return Promise.resolve({ data: { ok: true }, error: null }); } } as unknown as Db;
  return { calls, client };
};

describe("personal RPC wrappers", () => {
  it("personalCreate: 기본값은 null/빈 문자열", async () => {
    const f = fakeDb();
    await personalCreate("aws", "7", "복습", undefined, f.client);
    expect(f.calls[0]).toEqual(["personal_create", { p_slug: "aws", p_round_id: "7", p_title: "복습", p_start_date: null, p_end_date: null, p_description_md: "" }]);
  });
  it("personalCreate: 옵션 전달", async () => {
    const f = fakeDb();
    await personalCreate("aws", "7", "복습", { start: "2026-10-01", end: "2026-10-03", desc: "d" }, f.client);
    expect(f.calls[0][1]).toMatchObject({ p_start_date: "2026-10-01", p_end_date: "2026-10-03", p_description_md: "d" });
  });
  it("update/archive/delete/complete", async () => {
    const f = fakeDb();
    await personalUpdate("aws", "12", { title: "x", roundId: "8" }, f.client);
    await personalArchive("aws", "12", true, f.client);
    await personalDelete("aws", "12", f.client);
    await personalComplete("aws", "12", true, f.client);
    expect(f.calls).toEqual([
      ["personal_update", { p_slug: "aws", p_node_id: "12", p_patch: { title: "x", roundId: "8" } }],
      ["personal_archive", { p_slug: "aws", p_node_id: "12", p_archived: true }],
      ["personal_delete", { p_slug: "aws", p_node_id: "12" }],
      ["personal_complete", { p_slug: "aws", p_node_id: "12", p_done: true }],
    ]);
  });
  it("fetchMyTasks", async () => {
    const f = fakeDb();
    await fetchMyTasks(f.client);
    expect(f.calls[0]).toEqual(["me_tasks", {}]);
  });
});
