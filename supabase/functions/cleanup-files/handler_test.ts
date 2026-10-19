import { assertEquals } from "@std/assert";
import { MAX_SINGLE_FAILS, runAll, runCleanup, runOrphanCleanup, type Store } from "./cleanup.ts";
import { createHandler } from "./handler.ts";
import type { FileRow, ObjectRow, RemoveResult } from "./logic.ts";

const row = (id: string, bucket = "attachments"): FileRow => ({ id, bucket_id: bucket, object_path: `p/${id}` });

function fakeStore(rows: FileRow[], opts: {
  failBuckets?: string[]; badPaths?: string[]; failDelete?: boolean; failSelect?: boolean; orphans?: ObjectRow[]; failOrphanSelect?: boolean;
} = {}) {
  const calls = { select: [] as number[], remove: [] as [string, string[]][], del: [] as string[][], orphanSelect: [] as number[] };
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
    selectOrphans: (limit) => {
      calls.orphanSelect.push(limit);
      if (opts.failOrphanSelect) return Promise.reject(new Error("orphan select failed"));
      return Promise.resolve((opts.orphans ?? []).slice(0, limit));
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

Deno.test("runCleanup: 1개씩 재시도가 연속 MAX_SINGLE_FAILS 회 실패하면 그 묶음 나머지는 건너뛰고 다음 실행으로 미룬다", async () => {
  assertEquals(MAX_SINGLE_FAILS, 5);
  // 묶음 1(100개): Storage 다운 흉내 — 전부 실패. 묶음 2(다른 버킷)는 정상
  const rows = [...Array.from({ length: 100 }, (_, i) => row("x" + i)), row("ok", "covers")];
  const { store, calls } = fakeStore(rows, { failBuckets: ["attachments"] });
  const r = await runCleanup(store, { limit: 1000 });
  const att = calls.remove.filter(([b]) => b === "attachments");
  assertEquals(att.length, 1 + 5);                                          // 묶음 1회 + 1개씩 5회에서 멈춤
  assertEquals(att.slice(1).map(([, p]) => p), [["p/x0"], ["p/x1"], ["p/x2"], ["p/x3"], ["p/x4"]]);
  assertEquals(calls.del, [["ok"]]);                                         // 다음 묶음은 계속 처리
  assertEquals([r.removed, r.rowsDeleted, r.failed], [1, 1, 100]);           // 건너뛴 95개도 실패(남김)로 센다
  assertEquals(r.errors.at(-1), "remove attachments: 1개씩 재시도 연속 5회 실패 — 나머지 95개는 다음 실행으로");
});

Deno.test("runCleanup: 연속 실패 수는 성공하면 0 으로 돌아간다(띄엄띄엄 실패는 끝까지 시도)", async () => {
  const ids = Array.from({ length: 12 }, (_, i) => "y" + i);
  const bad = ids.filter((_, i) => i % 2 === 0).map((id) => "p/" + id);     // 6개 실패지만 연속은 1회씩
  const { store, calls } = fakeStore(ids.map((id) => row(id)), { badPaths: bad });
  const r = await runCleanup(store, { limit: 100 });
  assertEquals(calls.remove.length, 1 + 12);
  assertEquals([r.removed, r.failed], [6, 6]);
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
  assertEquals(await res.json(), {
    selected: 1, removed: 1, rowsDeleted: 1, failed: 0, errors: [], orphans: { selected: 0, removed: 0, failed: 0 },
  });
  await h(post({ "x-cleanup-secret": "s3cret" }));
  assertEquals(calls.select, [1, 500]);
  assertEquals(calls.orphanSelect, [1, 500]);   // 고아 정리도 같은 limit
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

// ───────── 0031 고아 객체(files 행 없음) ─────────
const orphan = (name: string, bucket = "attachments"): ObjectRow => ({ bucket_id: bucket, object_path: `o/${name}` });

Deno.test("runOrphanCleanup: file_orphan_candidates 로 고른 객체를 remove 만 한다(지울 행 없음)", async () => {
  const { store, calls } = fakeStore([], { orphans: [orphan("a"), orphan("b")] });
  const r = await runOrphanCleanup(store, { limit: 10 });
  assertEquals(calls.orphanSelect, [10]);
  assertEquals(calls.remove, [["attachments", ["o/a", "o/b"]]]);
  assertEquals(calls.del.length, 0);
  assertEquals(r, { selected: 2, removed: 2, failed: 0, errors: [] });
});

Deno.test("runOrphanCleanup: 100개 단위, 묶음 실패면 1개씩 재시도(실패 객체는 남아 다음 실행으로)", async () => {
  const many = Array.from({ length: 150 }, (_, i) => orphan(String(i)));
  const a = fakeStore([], { orphans: many });
  assertEquals((await runOrphanCleanup(a.store, { limit: 1000 })).removed, 150);
  assertEquals(a.calls.remove.map(([, p]) => p.length), [100, 50]);

  const b = fakeStore([], { orphans: [orphan("x"), orphan("bad"), orphan("y")], badPaths: ["o/bad"] });
  const r = await runOrphanCleanup(b.store, { limit: 10 });
  assertEquals([r.removed, r.failed], [2, 1]);
  assertEquals(r.errors, ["orphan remove attachments o/bad: storage down"]);
});

Deno.test("runOrphanCleanup: 후보 조회 실패는 throw 하지 않고 errors 로", async () => {
  const { store, calls } = fakeStore([], { failOrphanSelect: true });
  assertEquals(await runOrphanCleanup(store, { limit: 10 }), { selected: 0, removed: 0, failed: 0, errors: ["orphan select: orphan select failed"] });
  assertEquals(calls.remove.length, 0);
});

Deno.test("runAll: purge 먼저, 이어서 고아 — 요약은 purge 필드 그대로 + orphans, errors 합침", async () => {
  const { store, calls } = fakeStore([row("a")], { orphans: [orphan("z")] });
  const r = await runAll(store, { limit: 10 });
  assertEquals(calls.remove, [["attachments", ["p/a"]], ["attachments", ["o/z"]]]);
  assertEquals(r, { selected: 1, removed: 1, rowsDeleted: 1, failed: 0, errors: [], orphans: { selected: 1, removed: 1, failed: 0 } });
});

Deno.test("handler: 고아만 일부 실패 207, 고아 조회만 실패(purge 대상 없음) 500, purge 조회 실패면 고아는 건드리지 않고 500", async () => {
  const h = (s: Store) => createHandler({ secret: "s3cret", store: () => s })(post({ "x-cleanup-secret": "s3cret" }));
  const part = fakeStore([], { orphans: [orphan("ok"), orphan("bad")], badPaths: ["o/bad"] });
  const r1 = await h(part.store);
  assertEquals(r1.status, 207);
  assertEquals((await r1.json()).orphans, { selected: 2, removed: 1, failed: 1 });

  const sel = fakeStore([], { failOrphanSelect: true });
  const r2 = await h(sel.store);
  assertEquals(r2.status, 500);
  assertEquals((await r2.json()).errors, ["orphan select: orphan select failed"]);

  const purgeDown = fakeStore([], { failSelect: true, orphans: [orphan("z")] });
  assertEquals((await h(purgeDown.store)).status, 500);
  assertEquals(purgeDown.calls.orphanSelect.length, 0);
});
