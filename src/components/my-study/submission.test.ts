import { describe, expect, it } from "vitest";
import type { Submission, TaskDetail } from "@/lib/api/types";
import {
  SUB_LIMITS, addLink, checkFile, extOf, focusTargetOf, metaLine, mimeOf, myBadgeOf, myCardStateOf, objectKey,
  sizeText, stampKst, statusRows, submitBlocker, submitErrorAction, submitLabel,
} from "./submission";

const sub = (o: Partial<Submission> = {}): Submission =>
  ({ id: "s1", bodyMd: "본문", links: [], files: [], firstSubmittedAt: "2026-10-12T03:00:00.000Z", isLate: false, updatedAt: "2026-10-12T03:00:00.000Z", ...o });
const P = (userId: string, nickname: string, status: "done" | "late" | "missed" | "open" | "planned") => ({ userId, nickname, tone: "mint" as const, status });
const detail = (o: Partial<TaskDetail> = {}, node: Partial<TaskDetail["node"]> = {}): TaskDetail => ({
  today: "2026-10-12",
  node: { id: "21", parentId: "2", roundId: "2", depth: 3, sortOrder: 1, label: null, title: "EC2", descriptionMd: "", startDate: "2026-10-08", endDate: "2026-10-14", archived: false,
    task: { type: "designated", people: [P("u3", "지은", "done"), P("u1", "철수", "open")], assigned: 2, submitted: 1, state: "progress" }, assigned: 2, submitted: 1, pct: 50, ...node },
  path: [], mySubmission: null, isAssignee: true, allSubmitted: false, submissions: [], ...o,
});

describe("extOf / objectKey (서버 키 정규식 0007:193-194)", () => {
  it("lowercases, keeps last segment, drops invalid", () => {
    expect(extOf("photo.PNG")).toBe("png");
    expect(extOf("a.tar.gz")).toBe("gz");
    expect(extOf("README")).toBeNull();
    expect(extOf(".env")).toBeNull();
    expect(extOf("x.한글")).toBeNull();
    expect(extOf("x.abcdefghijk")).toBeNull(); // 11자
  });
  it("builds {room}/{node}/{user}/{uuid}[.ext]", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(objectKey("7", "21", "u-1", id, "노트.PNG")).toBe(`7/21/u-1/${id}.png`);
    expect(objectKey("7", "21", "u-1", id, "README")).toBe(`7/21/u-1/${id}`);
  });
});

describe("mimeOf / checkFile", () => {
  it("trusts an allowed browser type, falls back to extension when empty", () => {
    expect(mimeOf({ name: "a.png", type: "image/png" })).toBe("image/png");
    expect(mimeOf({ name: "a.md", type: "" })).toBe("text/markdown");
    expect(mimeOf({ name: "a.zip", type: "" })).toBe("application/zip");
    expect(mimeOf({ name: "a.svg", type: "image/svg+xml" })).toBeNull();
    expect(mimeOf({ name: "a.exe", type: "" })).toBeNull();
  });
  it("rejects size, type and slot overflow with spec copy", () => {
    expect(checkFile({ name: "a.png", type: "image/png", size: SUB_LIMITS.fileBytes + 1 }, 5)).toEqual({ ok: false, error: "10MB를 넘는 파일이에요" });
    expect(checkFile({ name: "a.exe", type: "", size: 1 }, 5)).toEqual({ ok: false, error: "올릴 수 없는 형식이에요" });
    expect(checkFile({ name: "a.png", type: "image/png", size: 1 }, 0)).toEqual({ ok: false, error: "첨부는 5개까지예요" });
    expect(checkFile({ name: "a.png", type: "image/png", size: SUB_LIMITS.fileBytes }, 1)).toEqual({ ok: true, mime: "image/png" });
    expect(checkFile({ name: "a.png", type: "image/png", size: 0 }, 1)).toEqual({ ok: false, error: "빈 파일은 올릴 수 없어요" });
  });
});

describe("addLink", () => {
  it("trims and appends http(s) links", () => expect(addLink("  https://a.example/x ", [])).toEqual({ ok: true, links: ["https://a.example/x"] }));
  it("rejects non-http, spaces, duplicates, overflow, too long", () => {
    expect(addLink("ftp://a", [])).toEqual({ ok: false, error: "http:// 또는 https:// 로 시작하는 주소만 넣을 수 있어요" });
    expect(addLink("https://a b", [])).toMatchObject({ ok: false });
    expect(addLink("https://a", ["https://a"])).toEqual({ ok: false, error: "이미 넣은 링크예요" });
    expect(addLink("https://z", Array.from({ length: 20 }, (_, i) => `https://${i}`))).toEqual({ ok: false, error: "링크는 20개까지예요" });
    expect(addLink("https://" + "a".repeat(2000), [])).toMatchObject({ ok: false });
    expect(addLink("   ", [])).toEqual({ ok: false, error: "" }); // 빈 입력은 조용히 무시
  });
});

describe("submitBlocker", () => {
  const ready = { status: "ready" as const };
  it("needs one of body/link/file", () => expect(submitBlocker({ body: "  ", links: [], files: [] }, true)).toBe("내용·링크·파일 중 하나는 있어야 해요"));
  it("blocks while uploading or with failed rows", () => {
    expect(submitBlocker({ body: "a", links: [], files: [{ status: "uploading" }] }, true)).toBe("파일을 올리는 중이에요");
    expect(submitBlocker({ body: "a", links: [], files: [{ status: "error" }] }, true)).toBe("올리지 못한 파일을 빼거나 다시 올려 주세요");
  });
  it("offline and body length", () => {
    expect(submitBlocker({ body: "a", links: [], files: [] }, false)).toBe("인터넷 연결을 확인해 주세요");
    expect(submitBlocker({ body: "a".repeat(50_001), links: [], files: [] }, true)).toBe("본문은 50,000자까지예요");
  });
  it("ok with only a file", () => expect(submitBlocker({ body: "", links: [], files: [ready] }, true)).toBeNull());
});

describe("myCardStateOf — 판정 순서 (Review Focus 2)", () => {
  const S = (d: TaskDetail, room: "draft" | "recruit" | "active" | "ended" = "active") => myCardStateOf(d, room);
  it("not assignee, nothing submitted → hidden", () => expect(S(detail({ isAssignee: false }))).toEqual({ kind: "hidden" }));
  it("released with a submission → readonly", () =>
    expect(S(detail({ isAssignee: false, mySubmission: sub() }))).toEqual({ kind: "readonly", note: "담당에서 빠져 더 고칠 수 없어요 · 제출물은 남아 있어요" }));
  it("ended room", () => {
    expect(S(detail({ mySubmission: sub() }), "ended")).toEqual({ kind: "readonly", note: "종료된 스터디라 더 고칠 수 없어요" });
    expect(S(detail(), "ended")).toEqual({ kind: "blocked", note: "종료된 스터디라 제출할 수 없어요" });
  });
  it("room not started", () => expect(S(detail(), "recruit")).toEqual({ kind: "blocked", note: "스터디가 시작되면 제출할 수 있어요" }));
  it("archived task", () => {
    expect(S(detail({ mySubmission: sub() }, { archived: true }))).toEqual({ kind: "readonly", note: "보관된 과제라 제출·수정할 수 없어요" });
    expect(S(detail({}, { archived: true }))).toEqual({ kind: "blocked", note: "보관된 과제라 제출·수정할 수 없어요" });
  });
  it("before start → blocked with date", () => expect(S(detail({}, { startDate: "2026-10-15" }))).toEqual({ kind: "blocked", note: "10.15(목)부터 제출할 수 있어요" }));
  it("submitted → submitted, else compose", () => {
    expect(S(detail({ mySubmission: sub() }))).toEqual({ kind: "submitted" });
    expect(S(detail())).toEqual({ kind: "compose" });
  });
});

describe("labels", () => {
  it("submitLabel", () => {
    expect(submitLabel(null, "2026-10-12", "2026-10-14")).toBe("제출하기");
    expect(submitLabel(null, "2026-10-15", "2026-10-14")).toBe("지각 제출하기");
    expect(submitLabel(sub(), "2026-10-15", "2026-10-14")).toBe("수정 저장");
  });
  it("myBadgeOf", () => {
    expect(myBadgeOf(detail())).toEqual({ status: "open", text: "제출 전 · D-2" });
    expect(myBadgeOf(detail({ today: "2026-10-15" }))).toEqual({ status: "missed", text: "미제출 · 마감 지남" });
    expect(myBadgeOf(detail({ mySubmission: sub({ isLate: true }) }))).toEqual({ status: "late", text: "지각 제출" });
    expect(myBadgeOf(detail({ mySubmission: sub() }))).toEqual({ status: "done", text: "기한내 제출" });
    expect(myBadgeOf(detail({}, { startDate: "2026-10-13" }))).toEqual({ status: "planned", text: "예정" });
  });
  it("stampKst / metaLine / sizeText", () => {
    expect(stampKst("2026-10-12T03:00:00.000Z")).toBe("10.12(월) 12:00");
    expect(stampKst("2026-10-03T15:00:30.000Z")).toBe("10.04(일) 00:00");
    expect(metaLine(sub())).toBe("처음 제출 10.12(월) 12:00");
    expect(metaLine(sub({ updatedAt: "2026-10-13T00:10:00.000Z" }))).toBe("처음 제출 10.12(월) 12:00 · 마지막 수정 10.13(화) 09:10");
    expect(sizeText(900)).toBe("900B");
    expect(sizeText(4096)).toBe("4KB");
    expect(sizeText(1_572_864)).toBe("1.5MB");
  });
});

describe("statusRows (Review Focus 4)", () => {
  it("assignees in order, attaches readable submissions, marks me", () => {
    const d = detail({ submissions: [{ ...sub({ id: "a" }), author: { userId: "u3", nickname: "지은", tone: "peach" } }] });
    const rows = statusRows(d, "u1");
    expect(rows.map((r) => [r.userId, r.status, r.me, r.submission?.id ?? null, r.released])).toEqual([["u3", "done", false, "a", false], ["u1", "open", true, null, false]]);
  });
  it("appends released authors after assignees", () => {
    const d = detail({ submissions: [{ ...sub({ id: "x", isLate: true }), author: { userId: "u9", nickname: "도윤", tone: "slate" } }] });
    expect(statusRows(d, "u1").at(-1)).toMatchObject({ userId: "u9", status: "late", released: true });
  });
  it("archived (people empty) builds rows from submissions only", () => {
    const d = detail({ submissions: [{ ...sub({ id: "a" }), author: { userId: "u3", nickname: "지은", tone: "peach" } }] }, { archived: true, task: { type: "common", people: [], assigned: 0, submitted: 0, state: "unassigned" } });
    expect(statusRows(d, "u2").map((r) => [r.userId, r.released])).toEqual([["u3", false]]);
  });
  it("never invents a submission for a done person without one (pending viewer)", () =>
    expect(statusRows(detail(), "u1")[0].submission).toBeNull());
});

describe("focusTargetOf", () => {
  it("compose → mine, otherwise status", () => {
    expect(focusTargetOf({ kind: "compose" })).toBe("mine");
    expect(focusTargetOf({ kind: "submitted" })).toBe("status");
    expect(focusTargetOf({ kind: "hidden" })).toBe("status");
  });
});

describe("submitErrorAction", () => {
  it("maps server codes", () => {
    for (const code of ["TASK_NOT_ASSIGNED", "TASK_ARCHIVED", "PARENT_ARCHIVED", "ROOM_NOT_ACTIVE", "TASK_NOT_STARTED", "NODE_NOT_FOUND"])
      expect(submitErrorAction({ code, message: "m" })).toEqual({ kind: "refetch", text: "m" });
    expect(submitErrorAction({ code: "FILE_NOT_READY", message: "m", details: { fileId: "f1" } })).toEqual({ kind: "file", fileId: "f1", text: "이 파일을 다시 올려 주세요" });
    expect(submitErrorAction({ code: "NOT_FOUND", message: "m", details: { fileId: "f1" } })).toEqual({ kind: "file", fileId: "f1", text: "이 파일을 다시 올려 주세요" });
    expect(submitErrorAction({ code: "INVALID_LINK", message: "m", details: { field: "links", index: "2" } })).toEqual({ kind: "link", index: 2, text: "m" });
    expect(submitErrorAction({ code: "AUTH_REQUIRED", message: "m" })).toEqual({ kind: "login", text: "m" });
    expect(submitErrorAction({ code: "UNKNOWN", message: "Failed to fetch" })).toEqual({ kind: "toast", text: "제출하지 못했어요 · 연결을 확인하고 다시 눌러 주세요" });
    expect(submitErrorAction({ code: "VALIDATION_FAILED", message: "본문은 50,000자까지예요" })).toEqual({ kind: "toast", text: "본문은 50,000자까지예요" });
  });
});
