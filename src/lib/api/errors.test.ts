import { describe, expect, it } from "vitest";
import { ApiException, rpc, toApiError, type Db } from "./errors";

describe("toApiError", () => {
  it("maps a PostgREST P0001 error: message→code, details→message, hint→details", () => {
    const e = { code: "P0001", message: "ROOM_FULL", details: "정원이 찼어요", hint: '{"field":"maxMembers"}', name: "PostgrestError" };
    expect(toApiError(e)).toEqual({ code: "ROOM_FULL", message: "정원이 찼어요", details: { field: "maxMembers" } });
  });

  it("keeps a non-JSON hint out of details", () => {
    const e = { code: "P0001", message: "AUTH_REQUIRED", details: "로그인이 필요해요", hint: "", name: "PostgrestError" };
    expect(toApiError(e)).toEqual({ code: "AUTH_REQUIRED", message: "로그인이 필요해요", details: undefined });
  });

  it("normalizes the server's empty-object hint ({}) to undefined details", () => {
    const e = { code: "P0001", message: "NOT_LEADER", details: "그룹장만 할 수 있어요", hint: "{}", name: "PostgrestError" };
    expect(toApiError(e)).toEqual({ code: "NOT_LEADER", message: "그룹장만 할 수 있어요", details: undefined });
  });

  it("drops a hint that parses to a non-object (string/array)", () => {
    const base = { code: "P0001", message: "ROOM_FULL", details: "정원이 찼어요", name: "PostgrestError" };
    expect(toApiError({ ...base, hint: '"abc"' }).details).toBeUndefined();
    expect(toApiError({ ...base, hint: '["a"]' }).details).toBeUndefined();
  });

  it("falls back to UNKNOWN for a PostgREST error whose message is not a CODE", () => {
    const e = { code: "42883", message: "function public.nope() does not exist", details: null, hint: null, name: "PostgrestError" };
    expect(toApiError(e)).toEqual({ code: "UNKNOWN", message: "function public.nope() does not exist", details: undefined });
  });

  it("wraps a plain Error (network failure) as UNKNOWN with its message", () => {
    expect(toApiError(new TypeError("Failed to fetch"))).toEqual({ code: "UNKNOWN", message: "Failed to fetch" });
  });

  it("passes an ApiException through unchanged", () => {
    const ex = new ApiException({ code: "NOT_LEADER", message: "그룹장만 할 수 있어요" });
    expect(toApiError(ex)).toEqual({ code: "NOT_LEADER", message: "그룹장만 할 수 있어요", details: undefined });
    expect(ex.message).toBe("그룹장만 할 수 있어요");
  });

  it("handles a non-Error throw", () => {
    expect(toApiError("boom")).toEqual({ code: "UNKNOWN", message: "알 수 없는 오류가 발생했어요" });
  });
});

describe("rpc", () => {
  const stub = (res: { data: unknown; error: unknown }) => ({ rpc: async () => res }) as unknown as Db;

  it("returns data from the passed client", async () => {
    await expect(rpc<number>("x", {}, stub({ data: 7, error: null }))).resolves.toBe(7);
  });

  it("throws ApiException mapped from the PostgREST error", async () => {
    const error = { code: "P0001", message: "NOT_LEADER", details: "그룹장만 할 수 있어요", hint: "{}", name: "PostgrestError" };
    const p = rpc("x", {}, stub({ data: null, error }));
    await expect(p).rejects.toBeInstanceOf(ApiException);
    await expect(p).rejects.toMatchObject({ code: "NOT_LEADER", message: "그룹장만 할 수 있어요" });
  });
});
