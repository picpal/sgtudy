import { describe, expect, it } from "vitest";
import { commentErrorText, createComment, deleteComment, fetchComments, updateComment, validateComment } from "./comments";
import type { Db } from "./errors";

const fake = (data: unknown = {}) => {
  const calls: [string, unknown][] = [];
  const client = { rpc: (name: string, args: unknown) => { calls.push([name, args]); return Promise.resolve({ data, error: null }); } } as unknown as Db;
  return { calls, client };
};
const U = "11111111-2222-3333-4444-555555555555";

describe("comments adapter — RPC 이름·인자(0041)", () => {
  it("each call maps to the SQL signature (ids → number, absent cursors → null)", async () => {
    const f = fake();
    await fetchComments("aws", "7", {}, f.client);
    await fetchComments("aws", "7", { before: "30" }, f.client);
    await fetchComments("aws", "7", { from: "31" }, f.client);
    await createComment("aws", "7", `<@${U}> 안녕`, f.client);
    await updateComment("aws", "31", "고친 글", f.client);
    await deleteComment("aws", "31", f.client);
    expect(f.calls).toEqual([
      ["comment_list", { p_slug: "aws", p_node: 7, p_before: null, p_from: null }],
      ["comment_list", { p_slug: "aws", p_node: 7, p_before: 30, p_from: null }],
      ["comment_list", { p_slug: "aws", p_node: 7, p_before: null, p_from: 31 }],
      ["comment_create", { p_slug: "aws", p_node: 7, p_body: `<@${U}> 안녕` }],
      ["comment_update", { p_slug: "aws", p_id: 31, p_body: "고친 글" }],
      ["comment_delete", { p_slug: "aws", p_id: 31 }],
    ]);
  });

  it("deleteComment resolves undefined", async () => {
    await expect(deleteComment("aws", "1", fake(null).client)).resolves.toBeUndefined();
  });

  it("server error → ApiException with code/details", async () => {
    const client = { rpc: () => Promise.resolve({ data: null, error: { message: "RATE_LIMITED", details: "x", hint: '{"retryAfterSec":42,"window":"minute"}', code: "P0001" } }) } as unknown as Db;
    await expect(createComment("aws", "7", "b", client)).rejects.toMatchObject({ code: "RATE_LIMITED", details: { retryAfterSec: 42 } });
  });
});

describe("validateComment", () => {
  it("non-blank · ≤2000 display chars (token = 1) · ≤10 mentions", () => {
    expect(validateComment(" \n ")).toEqual({ field: "body", text: "댓글 내용을 입력해 주세요" });
    expect(validateComment("가".repeat(2000))).toBeNull();
    expect(validateComment(` ${"가".repeat(2000)}\n`)).toBeNull();
    expect(validateComment("가".repeat(2001))?.field).toBe("body");
    expect(validateComment("가".repeat(1999) + `<@${U}>`)).toBeNull();
    const many = Array.from({ length: 11 }, (_, i) => `<@${String(i).padStart(8, "0")}-2222-3333-4444-555555555555>`).join(" ");
    expect(validateComment(many)).toEqual({ field: "mentions", text: "한 댓글에서 10명까지 부를 수 있어요" });
  });
});

describe("commentErrorText", () => {
  it("details-specific copy · server message · fallback", () => {
    expect(commentErrorText({ code: "NOT_MEMBER", message: "x", details: { state: "pending" } })).toBe("참가가 승인되면 댓글을 볼 수 있어요");
    expect(commentErrorText({ code: "NOT_MEMBER", message: "x", details: { state: "inactive" } })).toBe("이탈한 스터디에는 댓글을 쓸 수 없어요");
    expect(commentErrorText({ code: "ROOM_NOT_EDITABLE", message: "x", details: { reason: "archived_node" } })).toBe("보관된 항목에는 댓글을 쓸 수 없어요");
    expect(commentErrorText({ code: "RATE_LIMITED", message: "요청이 너무 잦아요" })).toBe("댓글을 너무 빨리 쓰고 있어요 · 잠시 후 다시 해 주세요");
    expect(commentErrorText({ code: "NOT_AUTHOR", message: "내가 쓴 댓글만 지울 수 있어요" })).toBe("내가 쓴 댓글만 지울 수 있어요");
    expect(commentErrorText({ code: "COMMENT_NOT_FOUND", message: "COMMENT_NOT_FOUND" })).toBe("댓글을 찾을 수 없어요 · 이미 삭제됐을 수 있어요");
    expect(commentErrorText({ code: "COMMENT_LOCKED", message: "" })).toBe("시험을 제출하면 댓글을 볼 수 있어요");
    expect(commentErrorText({ code: "WHAT", message: "" })).toBe("처리하지 못했어요 · 잠시 후 다시 시도해 주세요");
  });
});
