import { assertEquals } from "@std/assert";
import { runCleanup, type Store } from "./cleanup.ts";
import { createHandler } from "./handler.ts";
import type { FileRow, RemoveResult } from "./logic.ts";

const row = (id: string, bucket = "attachments"): FileRow => ({ id, bucket_id: bucket, object_path: `p/${id}` });

function fakeStore(rows: FileRow[], opts: { failBuckets?: string[]; badPaths?: string[]; failDelete?: boolean; failSelect?: boolean } = {}) {
  const calls = { select: [] as number[], remove: [] as [string, string[]][], del: [] as string[][] };
  const store: Store = {
    selectDeleted: (limit) => {
      calls.select.push(limit);
      if (opts.failSelect) return Promise.reject(new Error("select failed"));
      return Promise.resolve(rows.slice(0, limit));
    },
    removeObjects: (bucket, paths): Promise<RemoveResult> => {
      calls.remove.push([bucket, paths]);
      const bad = opts.failBuckets?.includes(bucket) || paths.some((p) => opts.badPaths?.includes(p));
      return Promise.resolve(bad ? { data: null, error: { message: "storage down" } } : { data: [], error: null });
    },
    deleteRows: (ids) => {
      calls.del.push(ids);
      return opts.failDelete ? Promise.reject(new Error("delete failed")) : Promise.resolve(ids.length);
    },
  };
  return { store, calls };
}

Deno.test("runCleanup: 상한으로 고르고(유예는 DB 의 file_purge_candidates), 버킷별 remove 후 성공한 행만 지운다", async () => {
  const { store, calls } = fakeStore([row("a"), row("b", "covers"), row("c")]);
  const r = await runCleanup(store, { limit: 10 });
  assertEquals(calls.select, [10]);
  assertEquals(calls.remove, [["attachments", ["p/a", "p/c"]], ["covers", ["p/b"]]]);
  assertEquals(calls.del, [["a", "c", "b"]]);
  assertEquals(r, { selected: 3, removed: 3, rowsDeleted: 3, failed: 0, errors: [] });
});

Deno.test("runCleanup: remove 실패한 버킷의 행은 남긴다(다음 실행에 재시도)", async () => {
  const { store, calls } = fakeStore([row("a"), row("b", "covers")], { failBuckets: ["covers"] });
  const r = await runCleanup(store, { limit: 10 });
  assertEquals(calls.del, [["a"]]);
  assertEquals(calls.remove, [["attachments", ["p/a"]], ["covers", ["p/b"]]]);   // 1개짜리 묶음은 다시 시도하지 않는다
  assertEquals(r.removed, 1);
  assertEquals(r.rowsDeleted, 1);
  assertEquals(r.failed, 1);
  assertEquals(r.errors, ["remove covers p/b: storage down"]);
});

Deno.test("runCleanup: 묶음 remove 가 실패하면 1개씩 다시 시도해 정상 행은 정리한다", async () => {
  const { store, calls } = fakeStore([row("a"), row("b"), row("c")], { badPaths: ["p/b"] });
  const r = await runCleanup(store, { limit: 10 });
  assertEquals(calls.remove, [["attachments", ["p/a", "p/b", "p/c"]], ["attachments", ["p/a"]], ["attachments", ["p/b"]], ["attachments", ["p/c"]]]);
  assertEquals(calls.del, [["a", "c"]]);
  assertEquals([r.removed, r.rowsDeleted, r.failed], [2, 2, 1]);
  assertEquals(r.errors, ["remove attachments p/b: storage down"]);
});

Deno.test("runCleanup: 대상이 없으면 아무것도 부르지 않는다(멱등)", async () => {
  const { store, calls } = fakeStore([]);
  assertEquals(await runCleanup(store, { limit: 10 }), { selected: 0, removed: 0, rowsDeleted: 0, failed: 0, errors: [] });
  assertEquals(calls.remove.length + calls.del.length, 0);
});

Deno.test("runCleanup: 100개 단위로 나눠 remove·delete 한다", async () => {
  const rows = Array.from({ length: 250 }, (_, i) => row(String(i)));
  const { store, calls } = fakeStore(rows);
  const r = await runCleanup(store, { limit: 1000 });
  assertEquals(calls.remove.map(([, p]) => p.length), [100, 100, 50]);
  assertEquals(calls.del.map((x) => x.length), [100, 100, 50]);
  assertEquals(r.rowsDeleted, 250);
});

Deno.test("runCleanup: 행 delete 실패는 오류로 남기고 계속한다(객체는 이미 없음 → 다음 실행이 행을 지운다)", async () => {
  const { store } = fakeStore([row("a")], { failDelete: true });
  const r = await runCleanup(store, { limit: 10 });
  assertEquals(r.removed, 1);
  assertEquals(r.rowsDeleted, 0);
  assertEquals(r.errors, ["delete rows: delete failed"]);
});

const post = (headers: Record<string, string> = {}, body?: string) =>
  new Request("http://x/functions/v1/cleanup-files", { method: "POST", headers, body });

Deno.test("handler: 시크릿 헤더 없거나 틀리면 401, 시크릿 미설정이면 401, POST 외 405", async () => {
  const { store, calls } = fakeStore([row("a")]);
  const h = createHandler({ secret: "s3cret", store: () => store });
  assertEquals((await h(post())).status, 401);
  assertEquals((await h(post({ "x-cleanup-secret": "nope" }))).status, 401);
  assertEquals((await h(post({ authorization: "Bearer s3cret" }))).status, 401);
  assertEquals((await h(new Request("http://x/", { method: "GET", headers: { "x-cleanup-secret": "s3cret" } }))).status, 405);
  const closed = createHandler({ secret: undefined, store: () => store });
  assertEquals((await closed(post({ "x-cleanup-secret": "" }))).status, 401);
  assertEquals(calls.select.length, 0);
});

Deno.test("handler: 올바른 시크릿이면 200 + 요약, body.limit 반영(빈 body 는 기본값)", async () => {
  const { store, calls } = fakeStore([row("a"), row("b")]);
  const h = createHandler({ secret: "s3cret", store: () => store });
  const res = await h(post({ "x-cleanup-secret": "s3cret", "content-type": "application/json" }, JSON.stringify({ limit: 1 })));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { selected: 1, removed: 1, rowsDeleted: 1, failed: 0, errors: [] });
  await h(post({ "x-cleanup-secret": "s3cret" }));
  assertEquals(calls.select, [1, 500]);
});

Deno.test("handler: 선택 쿼리 실패는 500", async () => {
  const { store } = fakeStore([], { failSelect: true });
  const h = createHandler({ secret: "s3cret", store: () => store });
  const res = await h(post({ "x-cleanup-secret": "s3cret" }));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "select failed");
});

Deno.test("handler: 일부 실패 207 + failed 수, 전부 실패 500 (pg_net 응답 기록으로 보이게)", async () => {
  const part = fakeStore([row("a"), row("b", "covers")], { failBuckets: ["covers"] });
  const res = await createHandler({ secret: "s3cret", store: () => part.store })(post({ "x-cleanup-secret": "s3cret" }));
  assertEquals(res.status, 207);
  assertEquals((await res.json()).failed, 1);
  const all = fakeStore([row("b", "covers")], { failBuckets: ["covers"] });
  const res2 = await createHandler({ secret: "s3cret", store: () => all.store })(post({ "x-cleanup-secret": "s3cret" }));
  assertEquals(res2.status, 500);
  assertEquals((await res2.json()).failed, 1);
});
