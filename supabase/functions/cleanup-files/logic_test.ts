import { assertEquals } from "@std/assert";
import { chunk, cutoffIso, GRACE_MS, groupByBucket, isAuthorized, MAX_LIMIT, parseLimit, DEFAULT_LIMIT, splitRemoval } from "./logic.ts";

Deno.test("parseLimit: 없으면 기본값, 숫자 문자열 허용, 1..MAX 로 자른다, 이상값은 기본값", () => {
  assertEquals(parseLimit(undefined), DEFAULT_LIMIT);
  assertEquals(parseLimit(null), DEFAULT_LIMIT);
  assertEquals(parseLimit(10), 10);
  assertEquals(parseLimit("25"), 25);
  assertEquals(parseLimit(MAX_LIMIT + 1), MAX_LIMIT);
  assertEquals(parseLimit(0), 1);
  assertEquals(parseLimit(-5), 1);
  assertEquals(parseLimit(2.7), 2);
  assertEquals(parseLimit("abc"), DEFAULT_LIMIT);
  assertEquals(parseLimit({}), DEFAULT_LIMIT);
});

Deno.test("cutoffIso: now - 유예(1시간)", () => {
  const now = new Date("2026-10-17T05:00:00.000Z");
  assertEquals(GRACE_MS, 60 * 60 * 1000);
  assertEquals(cutoffIso(now), "2026-10-17T04:00:00.000Z");
});

Deno.test("groupByBucket: 버킷별로 묶고 행 순서를 지킨다", () => {
  const rows = [
    { id: "a", bucket_id: "attachments", object_path: "1/2/u/a.pdf" },
    { id: "b", bucket_id: "covers", object_path: "c/b.png" },
    { id: "c", bucket_id: "attachments", object_path: "1/2/u/c.pdf" },
  ];
  const g = groupByBucket(rows);
  assertEquals([...g.keys()], ["attachments", "covers"]);
  assertEquals(g.get("attachments")!.map((r) => r.id), ["a", "c"]);
  assertEquals(g.get("covers")!.map((r) => r.id), ["b"]);
});

Deno.test("chunk: 크기대로 자른다", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 3), []);
});

Deno.test("splitRemoval: 오류 없으면 요청 전부 성공(이미 없는 객체 = 응답 목록에 없어도 성공), 오류면 전부 실패", () => {
  const rows = [
    { id: "a", bucket_id: "attachments", object_path: "p/a" },
    { id: "b", bucket_id: "attachments", object_path: "p/b" },
  ];
  // Storage 는 실제로 지운 객체만 돌려준다 — b 는 이미 없었다
  assertEquals(splitRemoval(rows, { data: [{ name: "p/a" }], error: null }), { ok: ["a", "b"], failed: [] });
  assertEquals(splitRemoval(rows, { data: [], error: null }), { ok: ["a", "b"], failed: [] });
  assertEquals(splitRemoval(rows, { data: null, error: { message: "boom" } }), { ok: [], failed: ["a", "b"] });
});

Deno.test("isAuthorized: 시크릿 미설정이면 항상 거부, 헤더가 정확히 같을 때만 허용", () => {
  assertEquals(isAuthorized(undefined, "x"), false);
  assertEquals(isAuthorized("", ""), false);
  assertEquals(isAuthorized("s3cret-value", null), false);
  assertEquals(isAuthorized("s3cret-value", "s3cret-valu"), false);
  assertEquals(isAuthorized("s3cret-value", "s3cret-valuX"), false);
  assertEquals(isAuthorized("s3cret-value", "S3cret-value"), false);
  assertEquals(isAuthorized("s3cret-value", "s3cret-value"), true);
});
