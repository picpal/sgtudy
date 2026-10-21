import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import { createNotice, deleteNotice, fetchNoticeInbox, fetchNotices, markNoticesRead, noticeErrorText, updateNotice, validateNotice } from "./notices";

const fake = (data: unknown = {}) => {
  const calls: [string, unknown][] = [];
  const client = { rpc: (name: string, args: unknown) => { calls.push([name, args]); return Promise.resolve({ data, error: null }); } } as unknown as Db;
  return { calls, client };
};

describe("notices adapter — RPC 이름·인자(0040)", () => {
  it("each call maps to the SQL signature (ids → number)", async () => {
    const f = fake();
    await fetchNotices("aws", f.client);
    await fetchNoticeInbox("aws", f.client);
    await createNotice("aws", { title: "규칙", bodyMd: "본문", popup: true }, f.client);
    await updateNotice("aws", "12", { renotify: true }, f.client);
    await deleteNotice("aws", "12", f.client);
    await markNoticesRead("aws", ["12", "13"], undefined, f.client);
    await markNoticesRead("aws", ["12"], [2], f.client);
    expect(f.calls).toEqual([
      ["notice_list", { p_slug: "aws" }],
      ["notice_inbox", { p_slug: "aws" }],
      ["notice_create", { p_slug: "aws", p_input: { title: "규칙", bodyMd: "본문", popup: true } }],
      ["notice_update", { p_slug: "aws", p_id: 12, p_patch: { renotify: true } }],
      ["notice_delete", { p_slug: "aws", p_id: 12 }],
      ["notice_read", { p_slug: "aws", p_ids: [12, 13] }],
      ["notice_read", { p_slug: "aws", p_ids: [12], p_revs: [2] }],   // 본 리비전
    ]);
  });

  it("deleteNotice resolves undefined · markNoticesRead returns unread", async () => {
    await expect(deleteNotice("aws", "1", fake(null).client)).resolves.toBeUndefined();
    await expect(markNoticesRead("aws", ["1"], undefined, fake({ unread: false }).client)).resolves.toEqual({ unread: false });
  });

  it("server error → ApiException with code/details", async () => {
    const client = { rpc: () => Promise.resolve({ data: null, error: { message: "NOTICE_LIMIT", details: "고정은 3개까지예요", hint: '{"kind":"pinned","max":3}', code: "P0001" } }) } as unknown as Db;
    await expect(createNotice("aws", { title: "t", bodyMd: "b", pinned: true }, client)).rejects.toMatchObject({ code: "NOTICE_LIMIT", details: { kind: "pinned" } });
  });
});

describe("validateNotice", () => {
  it("title 1~80 after trim · body non-blank ≤ 10,000 · both at once", () => {
    expect(validateNotice({ title: "  ", bodyMd: "b" })).toEqual({ title: "제목은 1~80자예요" });
    expect(validateNotice({ title: "가".repeat(81), bodyMd: "b" })).toEqual({ title: "제목은 1~80자예요" });
    expect(validateNotice({ title: ` ${"가".repeat(80)} `, bodyMd: "b" })).toBeNull();
    expect(validateNotice({ title: "t", bodyMd: " \n " })).toEqual({ bodyMd: "본문은 1~10,000자예요" });
    expect(validateNotice({ title: "t", bodyMd: "a".repeat(10_001) })).toEqual({ bodyMd: "본문은 1~10,000자예요" });
    expect(validateNotice({ title: "", bodyMd: "" })).toEqual({ title: "제목은 1~80자예요", bodyMd: "본문은 1~10,000자예요" });
    expect(validateNotice({ title: "t", bodyMd: "a".repeat(10_000) })).toBeNull();
  });
});

describe("noticeErrorText", () => {
  it("NOTICE_LIMIT by kind · pending NOT_MEMBER · server message · fallback", () => {
    expect(noticeErrorText({ code: "NOTICE_LIMIT", message: "x", details: { kind: "popup" } })).toBe("팝업 공지는 5개까지예요 · 오래된 공지의 팝업을 꺼 주세요");
    expect(noticeErrorText({ code: "NOTICE_LIMIT", message: "x", details: { kind: "total" } })).toBe("공지는 100개까지예요");
    expect(noticeErrorText({ code: "NOT_MEMBER", message: "x", details: { state: "pending" } })).toBe("참가가 승인되면 공지를 볼 수 있어요");
    expect(noticeErrorText({ code: "NOT_LEADER", message: "그룹장만 할 수 있어요" })).toBe("그룹장만 할 수 있어요");
    expect(noticeErrorText({ code: "NOTICE_NOT_FOUND", message: "NOTICE_NOT_FOUND" })).toBe("공지를 찾을 수 없어요 · 이미 삭제됐을 수 있어요");
    expect(noticeErrorText({ code: "WHAT", message: "" })).toBe("처리하지 못했어요 · 잠시 후 다시 시도해 주세요");
  });
});
