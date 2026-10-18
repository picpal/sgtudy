import { describe, expect, it } from "vitest";
import type { Submission, TaskDetail } from "@/lib/api/types";
import {
  SUB_LIMITS, addLink, checkFile, extOf, focusTargetOf, metaLine, mimeOf, myBadgeOf, myCardStateOf, emptyDescText, objectKey,
  sizeText, stampKst, statusRows, submitBlocker, submitErrorAction, submitLabel,
  composerHint, emptyAllowed, lateNote, withPendingLink, savedToast, notAssignedText, rowStatusText, showAllSubmitted, statusHeadOf,
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
  it("Q1-2: allowEmpty(완료한 개인 기록 수정)면 비워도 저장 가능 — 다른 막힘은 그대로", () => {
    expect(submitBlocker({ body: " ", links: [], files: [] }, true, { allowEmpty: true })).toBeNull();
    expect(submitBlocker({ body: "", links: [], files: [] }, false, { allowEmpty: true })).toBe("인터넷 연결을 확인해 주세요");
    expect(submitBlocker({ body: "", links: [], files: [{ status: "uploading" }] }, true, { allowEmpty: true })).toBe("파일을 올리는 중이에요");
  });
  it("회귀: 팀 과제(allowEmpty 없음)는 처음 제출·수정 모두 빈 내용 거부", () => {
    expect(submitBlocker({ body: "", links: [], files: [] }, true)).toBe("내용·링크·파일 중 하나는 있어야 해요");
    expect(submitBlocker({ body: "", links: [], files: [] }, true, { allowEmpty: false })).toBe("내용·링크·파일 중 하나는 있어야 해요");
  });
});

describe("SUBMISSION_EMPTY (0022 팀 과제 빈 제출 서버 거부)", () => {
  it("서버 문구 그대로 토스트 — 화면 EMPTY_BLOCKER 와 같은 문구", () =>
    expect(submitErrorAction({ code: "SUBMISSION_EMPTY", message: "내용·링크·파일 중 하나는 있어야 해요" } as never)).toEqual({ kind: "toast", text: "내용·링크·파일 중 하나는 있어야 해요" }));
});

describe("emptyAllowed — 빈 저장은 이미 완료한 개인 목표 기록만 (Q1-2)", () => {
  it("개인 + 내 기록 있음만 true", () => {
    expect(emptyAllowed(true, sub())).toBe(true);
    expect(emptyAllowed(true, null)).toBe(false);
    expect(emptyAllowed(false, sub())).toBe(false);
    expect(emptyAllowed(false, null)).toBe(false);
  });
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
  it("archived leaf releases assignees — my submission still reads as archived, not released", () =>
    expect(S(detail({ isAssignee: false, mySubmission: sub() }, { archived: true }))).toEqual({ kind: "readonly", note: "보관된 과제라 제출·수정할 수 없어요" }));
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
  it("myBadgeOf — 개인 목표는 완료 문구(codeLabel 과 같은 출처)", () => {
    const pd = (o: Partial<TaskDetail> = {}, node: Partial<TaskDetail["node"]> = {}) =>
      detail(o, { task: { type: "personal", people: [P("u1", "철수", "open")], assigned: 1, submitted: 0, state: "progress" }, ...node });
    expect(myBadgeOf(pd({ mySubmission: sub() }))).toEqual({ status: "done", text: "기한내 완료" });
    expect(myBadgeOf(pd({ mySubmission: sub({ isLate: true }) }))).toEqual({ status: "late", text: "늦게 완료" });
    expect(myBadgeOf(pd({ today: "2026-10-15" }))).toEqual({ status: "missed", text: "기한 지남" });
    expect(myBadgeOf(pd())).toEqual({ status: "open", text: "완료 전 · D-2" });
    expect(myBadgeOf(pd({}, { startDate: "2026-10-13" }))).toEqual({ status: "planned", text: "예정" });
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

describe("emptyDescText — 빈 설명 문구", () => {
  it("personal vs team", () => {
    expect(emptyDescText(true)).toBe("설명이 아직 없어요");
    expect(emptyDescText(false)).toBe("과제 설명이 아직 없어요");
  });
});

describe("myCardStateOf — 개인 목표 시작일 (0017: 서버 submission_upsert 가 PERSONAL 은 시작일 검사를 건너뜀)", () => {
  const personal = { startDate: "2026-10-15", task: { type: "personal" as const, people: [], assigned: 1, submitted: 0, state: "progress" as const } };
  it("personal before start → compose (no blocking)", () =>
    expect(myCardStateOf(detail({}, personal), "active")).toEqual({ kind: "compose" }));
  it("personal before start, already completed → submitted (memo editable)", () =>
    expect(myCardStateOf(detail({ mySubmission: sub() }, personal), "active")).toEqual({ kind: "submitted" }));
  it("team task before start stays blocked", () =>
    expect(myCardStateOf(detail({}, { startDate: "2026-10-15" }), "active")).toEqual({ kind: "blocked", note: "10.15(목)부터 제출할 수 있어요" }));
});

describe("개인 목표 제출 카드 문구 (최종 리뷰 I2) — 팀 과제는 그대로", () => {
  it("전원 제출 배너는 팀 과제만", () => {
    expect(showAllSubmitted(detail({ allSubmitted: true }))).toBe(true);
    expect(showAllSubmitted(detail({ allSubmitted: true }, { task: { type: "personal", people: [P("u1", "철수", "done")], assigned: 1, submitted: 1, state: "complete" } }))).toBe(false);
    expect(showAllSubmitted(detail({ allSubmitted: false }))).toBe(false);
  });
  it("지각 안내", () => {
    expect(lateNote(false)).toBe("마감 뒤에 처음 제출해 지각으로 기록됐어요");
    expect(lateNote(true)).toBe("마감 뒤에 완료해 늦게 완료로 기록됐어요");
  });
  it("현황 머리 — 팀 n/m, 개인은 개수 없이", () => {
    expect(statusHeadOf(false, 1, 2)).toBe("제출 현황 1/2");
    expect(statusHeadOf(true, 0, 0)).toBe("완료 현황");
  });
  it("현황 줄 상태 문구 — 개인은 codeLabel, 보관된 개인은 완료일 때만", () => {
    expect(rowStatusText("late", false, false)).toBe("지각 제출");
    expect(rowStatusText("missed", false, false)).toBe("미제출");
    expect(rowStatusText("late", true, false)).toBe("늦게 완료");
    expect(rowStatusText("missed", true, false)).toBe("기한 지남");
    expect(rowStatusText("open", true, true)).toBeNull();
    expect(rowStatusText("done", true, true)).toBe("기한내 완료");
    expect(rowStatusText("open", false, true)).toBe("진행중");
  });
  it("담당 아님 안내", () => {
    expect(notAssignedText(false)).toBe("담당 과제가 아니에요 · 제출 현황만 볼 수 있어요");
    expect(notAssignedText(true)).toBe("팀원의 개인 목표예요");
  });
});

describe("composerHint — 빈 상태는 처음엔 중립색 (Ruling)", () => {
  const EMPTY = "내용·링크·파일 중 하나는 있어야 해요";
  const base = { editing: false, late: false, personal: false, touched: false };
  it("처음 빈 작성 화면: 안내만, 경고색 아님", () => expect(composerHint({ ...base, blocker: EMPTY })).toEqual({ text: EMPTY, warn: false }));
  it("입력을 비웠으면(touched) 경고색", () => expect(composerHint({ ...base, blocker: EMPTY, touched: true })).toEqual({ text: EMPTY, warn: true }));
  it("다른 비활성 이유는 늘 경고색", () => expect(composerHint({ ...base, blocker: "파일을 올리는 중이에요" })).toEqual({ text: "파일을 올리는 중이에요", warn: true }));
  it("Q1-3 개인 목표 처음 작성: 저장 전에 '기록을 저장하면 완료로 표시돼요' + 빈 완료는 '완료로 표시'", () => {
    expect(composerHint({ ...base, personal: true, blocker: EMPTY })).toEqual({ text: "기록을 저장하면 완료로 표시돼요 · 내용 없이 완료하려면 위의 '완료로 표시'를 쓰세요", warn: false });
    expect(composerHint({ ...base, personal: true, blocker: EMPTY, touched: true })).toEqual({ text: "기록을 저장하면 완료로 표시돼요 · 내용 없이 완료하려면 위의 '완료로 표시'를 쓰세요", warn: true });
    expect(composerHint({ ...base, personal: true, blocker: null })).toEqual({ text: "기록을 저장하면 완료로 표시돼요", warn: false });
    expect(composerHint({ ...base, personal: true, blocker: null, late: true })).toEqual({ text: "기록을 저장하면 완료로 표시돼요 · 마감이 지나 늦게 완료로 기록돼요", warn: false });
  });
  it("Q1-2 완료한 개인 기록을 모두 비우면: 저장 가능 + 완료는 남고 그 뒤 완료 취소 가능 안내", () => {
    expect(composerHint({ ...base, personal: true, editing: true, blocker: null, empty: true, touched: true })).toEqual({
      text: "비운 채 저장해도 완료는 그대로예요 · 저장한 뒤 '완료 취소'를 누를 수 있어요",
      warn: false,
    });
  });
  it("회귀: 팀 과제 빈 안내·수정 안내 문구 불변", () => {
    expect(composerHint({ ...base, blocker: EMPTY, editing: true, touched: true })).toEqual({ text: EMPTY, warn: true });
    expect(composerHint({ ...base, blocker: null, editing: true, empty: true })).toEqual({ text: "마감 뒤에 고쳐도 지각 여부는 처음 제출 시각으로 정해져요", warn: false });
  });
  it("막힘 없음: 수정·지각 안내 — 팀 문구 그대로, 개인은 완료 문구", () => {
    expect(composerHint({ ...base, blocker: null })).toEqual({ text: null, warn: false });
    expect(composerHint({ ...base, blocker: null, late: true })).toEqual({ text: "마감이 지나 지각으로 기록돼요", warn: false });
    expect(composerHint({ ...base, blocker: null, editing: true })).toEqual({ text: "마감 뒤에 고쳐도 지각 여부는 처음 제출 시각으로 정해져요", warn: false });
    expect(composerHint({ ...base, personal: true, blocker: null, editing: true })).toEqual({ text: "마감 뒤에 고쳐도 늦게 완료 여부는 처음 완료 시각으로 정해져요", warn: false });
  });
});

describe("개인 목표 카드 남은 문구 (시안 A-6·A-7) — 팀 과제는 그대로", () => {
  it("submitLabel: 개인은 마감 뒤·수정도 '저장'", () => {
    expect(submitLabel(null, "2026-10-12", "2026-10-14", true)).toBe("저장");
    expect(submitLabel(null, "2026-10-15", "2026-10-14", true)).toBe("저장");
    expect(submitLabel(sub(), "2026-10-15", "2026-10-14", true)).toBe("저장");
    expect(submitLabel(null, "2026-10-15", "2026-10-14")).toBe("지각 제출하기");
  });
  it("metaLine: 개인은 '완료 {시각}'", () => {
    expect(metaLine(sub(), true)).toBe("완료 10.12(월) 12:00");
    expect(metaLine(sub({ updatedAt: "2026-10-13T00:10:00.000Z" }), true)).toBe("완료 10.12(월) 12:00 · 마지막 수정 10.13(화) 09:10");
    expect(metaLine(sub())).toBe("처음 제출 10.12(월) 12:00");
  });
  it("savedToast: 개인 처음 저장은 '저장했어요 · 완료로 표시했어요'(Q1-3), 수정은 '저장했어요', 팀은 제출했어요/지각 제출했어요/수정했어요", () => {
    expect(savedToast(false, true, true)).toBe("저장했어요 · 완료로 표시했어요");
    expect(savedToast(false, false, true)).toBe("저장했어요 · 완료로 표시했어요");
    expect(savedToast(true, false, true)).toBe("저장했어요");
    expect(savedToast(false, false, false)).toBe("제출했어요");
    expect(savedToast(false, true, false)).toBe("지각 제출했어요");
    expect(savedToast(true, true, false)).toBe("수정했어요");
  });
});

describe("withPendingLink — 추가 안 누른 입력칸 링크 (시나리오 QA #3)", () => {
  it("빈 입력이면 목록 그대로", () => {
    expect(withPendingLink("  ", ["https://a"])).toEqual({ links: ["https://a"], error: null, included: false });
  });
  it("유효하면 목록 끝에 포함", () => {
    expect(withPendingLink(" https://b ", ["https://a"])).toEqual({ links: ["https://a", "https://b"], error: null, included: true });
  });
  it("이미 넣은 링크면 그대로(오류 아님)", () => {
    expect(withPendingLink("https://a", ["https://a"])).toEqual({ links: ["https://a"], error: null, included: false });
  });
  it("형식이 틀리면 제출을 막는 오류", () => {
    const r = withPendingLink("naver.com", []);
    expect(r.links).toEqual([]);
    expect(r.error).toMatch(/http/);
  });
  it("빈 본문이어도 유효한 입력칸 링크가 있으면 빈 제출이 아니다", () => {
    const eff = withPendingLink("https://b", []);
    expect(submitBlocker({ body: "", links: eff.links, files: [] }, true)).toBeNull();
  });
});
