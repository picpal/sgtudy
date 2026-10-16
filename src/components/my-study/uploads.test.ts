import { describe, expect, it } from "vitest";
import type { FileMeta } from "@/lib/api/types";
import { fromSaved, removePlanOf, slotsLeft, uploadsReducer, readyIds, type UploadRow } from "./uploads";

const meta = (id: string): FileMeta => ({ id, name: `${id}.png`, contentType: "image/png", size: 4, status: "ready" });

describe("uploadsReducer", () => {
  it("add → progress → ready", () => {
    let s: UploadRow[] = [];
    s = uploadsReducer(s, { type: "add", row: { key: "k1", fileId: "f1", name: "a.png", size: 4, status: "uploading", progress: 0 } });
    s = uploadsReducer(s, { type: "progress", key: "k1", progress: 40 });
    expect(s[0]).toMatchObject({ status: "uploading", progress: 40 });
    s = uploadsReducer(s, { type: "ready", key: "k1", meta: meta("f1") });
    expect(s[0]).toMatchObject({ status: "ready", progress: 100, meta: meta("f1") });
  });
  it("fail keeps the row with an error; remove drops it; markError by fileId", () => {
    let s = fromSaved([meta("f1"), meta("f2")]);
    s = uploadsReducer(s, { type: "markError", fileId: "f2", error: "이 파일을 다시 올려 주세요" });
    expect(s[1]).toMatchObject({ status: "error", error: "이 파일을 다시 올려 주세요" });
    s = uploadsReducer(s, { type: "remove", key: s[0].key });
    expect(s.map((r) => r.fileId)).toEqual(["f2"]);
  });
  it("progress after remove is ignored (aborted upload races)", () =>
    expect(uploadsReducer([], { type: "progress", key: "gone", progress: 10 })).toEqual([]));
});

describe("helpers", () => {
  it("slotsLeft counts every row (uploading + ready + error)", () => expect(slotsLeft(fromSaved([meta("a"), meta("b")]))).toBe(3));
  it("readyIds in order", () => expect(readyIds(fromSaved([meta("a"), meta("b")]))).toEqual(["a", "b"]));
  it("removePlanOf: saved-attached → drop only; unattached ready → discard; uploading → abort; error → drop (Review Focus 5)", () => {
    const saved = new Set(["a"]);
    const rows = fromSaved([meta("a"), meta("b")]);
    expect(removePlanOf(rows[0], saved)).toBe("drop");
    expect(removePlanOf(rows[1], saved)).toBe("discard");
    expect(removePlanOf({ key: "k", fileId: "c", name: "c", size: 1, status: "uploading", progress: 5 }, saved)).toBe("abort");
    expect(removePlanOf({ key: "k", fileId: "c", name: "c", size: 1, status: "error", progress: 0, error: "x" }, saved)).toBe("drop");
  });
});
