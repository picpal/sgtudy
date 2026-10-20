import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import {
  absoluteUrl,
  approveApplicant,
  fetchApplications,
  fetchInvite,
  leaderErrorText,
  openRecruit,
  openRecruitNote,
  rejectApplicant,
  rotateInvite,
  showApplications,
  startBlockOf,
  startRoom,
  fetchNotifySettings,
  putNotifySettings,
  NOTIFY_ROWS,
  earlyStartDays,
  startDoneText,
  shiftChoiceText,
  statusActionOf,
  updateRoomEndDate,
  statusStepLabel,
} from "./leader";

const fake = () => {
  const calls: [string, Record<string, unknown>][] = [];
  const client = { rpc: (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return Promise.resolve({ data: {}, error: null }); } } as unknown as Db;
  return { calls, client };
};

describe("statusActionOf", () => {
  it("draft → openRecruit, recruit → start, active/ended → none", () => {
    expect(statusActionOf({ status: "draft", archived: false })).toBe("openRecruit");
    expect(statusActionOf({ status: "recruit", archived: false })).toBe("start");
    expect(statusActionOf({ status: "active", archived: false })).toBeNull();
    expect(statusActionOf({ status: "ended", archived: false })).toBeNull();
  });
  it("archived room has no action", () => expect(statusActionOf({ status: "draft", archived: true })).toBeNull());
});

describe("openRecruitNote", () => {
  it("public + direct", () => expect(openRecruitNote({ isPublic: true, joinMode: "direct" })).toBe("전체 공개 방 목록에 보이고 누구나 바로 참가할 수 있어요"));
  it("private + approval", () =>
    expect(openRecruitNote({ isPublic: false, joinMode: "approval" })).toBe("목록에는 안 보이고 초대 링크를 받은 사람만 참가 신청할 수 있어요 · 신청은 여기서 승인해요"));
});

describe("showApplications", () => {
  const d = { status: "recruit" as const, joinMode: "approval" as const, pendingCount: 0, archived: false };
  it("approval-mode recruit room shows the list even when empty", () => expect(showApplications(d)).toBe(true));
  it("direct room only when someone is still pending", () => {
    expect(showApplications({ ...d, joinMode: "direct" })).toBe(false);
    expect(showApplications({ ...d, joinMode: "direct", pendingCount: 2 })).toBe(true);
  });
  it("not outside recruit or when archived", () => {
    expect(showApplications({ ...d, status: "draft" })).toBe(false);
    expect(showApplications({ ...d, status: "ended", pendingCount: 1 })).toBe(false);
    expect(showApplications({ ...d, status: "active" })).toBe(false); // 0032: 진행중은 창이 열렸을 때만(대기자 없으면)
    expect(showApplications({ ...d, status: "active", pendingCount: 1 })).toBe(true); // 0032 스펙 §승인 대기 목록: 대기자가 남아 있으면 진행중도
    expect(showApplications({ ...d, archived: true })).toBe(false);
  });
});

describe("leader RPC wiring", () => {
  it("passes slug / user to the right RPCs", async () => {
    const { calls, client } = fake();
    await openRecruit("r1", client);
    await startRoom("r1", {}, client);
    await startRoom("r1", { shift: true }, client);
    await fetchInvite("r1", client);
    await rotateInvite("r1", client);
    await fetchApplications("r1", client);
    await approveApplicant("r1", "u9", client);
    await rejectApplicant("r1", "u9", client);
    await updateRoomEndDate("r1", "2027-03-01", client);
    expect(calls).toEqual([
      ["room_open_recruit", { p_slug: "r1" }],
      ["room_start", { p_slug: "r1" }],
      ["room_start", { p_slug: "r1", p_shift: true }],
      ["invite_get", { p_slug: "r1" }],
      ["invite_rotate", { p_slug: "r1" }],
      ["room_applications", { p_slug: "r1" }],
      ["room_approve", { p_slug: "r1", p_user: "u9" }],
      ["room_reject", { p_slug: "r1", p_user: "u9" }],
      ["room_update", { p_slug: "r1", p_patch: { endDate: "2027-03-01" } }],
    ]);
  });
});

describe("helpers", () => {
  it("absoluteUrl joins the invite path to the origin", () => expect(absoluteUrl("/invite/abc", "http://k1.localhost:3800")).toBe("http://k1.localhost:3800/invite/abc"));
  it("statusStepLabel", () => expect(["draft", "recruit", "active", "ended"].map((s) => statusStepLabel(s as "draft"))).toEqual(["준비중", "모집중", "진행중", "종료"]));
  it("leaderErrorText: no-leaf hint uses 진행목표, unknown codes keep the server message", () => {
    expect(leaderErrorText("ROOM_NO_LEAF_TASK", "x")).toBe("진행목표에 과제를 1개 이상 만들어야 모집을 시작할 수 있어요");
    expect(leaderErrorText("ROOM_FULL", "x")).toBe("정원이 가득 차서 승인할 수 없어요");
    expect(leaderErrorText("INVALID_PERIOD", "종료일이 이미 지났어요")).toBe("종료일이 이미 지났어요");
    expect(leaderErrorText("X", "")).toBe("처리하지 못했어요 · 잠시 후 다시 시도해 주세요");
  });
});

// 0016: 예정보다 일찍 "지금 시작"하면 시작일이 오늘로 당겨져 1년 상한을 넘을 수 있다 → PERIOD_TOO_LONG(detail.maxEndDate)
describe("startBlockOf (지금 시작 — 기간 1년 초과)", () => {
  it("PERIOD_TOO_LONG 은 전용 문구 + 줄여야 할 종료일 상한", () => {
    expect(startBlockOf({ code: "PERIOD_TOO_LONG", message: "기간은 최대 1년이에요", details: { field: "endDate", maxEndDate: "2027-10-16" } })).toEqual({
      text: "지금 시작하면 기간이 1년을 넘어요 · 종료일을 2027.10.16까지로 앞당긴 뒤 시작해 주세요",
      maxEndDate: "2027-10-16",
    });
  });
  it("상한이 안 오면 날짜 없이", () => {
    expect(startBlockOf({ code: "PERIOD_TOO_LONG", message: "x" })).toEqual({ text: "지금 시작하면 기간이 1년을 넘어요 · 종료일을 앞당긴 뒤 시작해 주세요", maxEndDate: null });
  });
  it("다른 오류는 null (일반 토스트)", () => expect(startBlockOf({ code: "ROOM_STATUS_INVALID", message: "x" })).toBeNull());
});

// 시나리오 QA D1 — 예정보다 일찍 "지금 시작" 하면 일정을 당길지 고른다 (0024 room_start p_shift, 0025 종료일도 함께)
describe("지금 시작 — 일정 당기기", () => {
  it("earlyStartDays: 모집중이고 오늘이 예정 시작일 전이면 남은 날수, 아니면 0", () => {
    expect(earlyStartDays({ status: "recruit", today: "2026-10-12", startDate: "2026-10-19" })).toBe(7);
    expect(earlyStartDays({ status: "recruit", today: "2026-10-19", startDate: "2026-10-19" })).toBe(0);
    expect(earlyStartDays({ status: "recruit", today: "2026-10-20", startDate: "2026-10-19" })).toBe(0);
    expect(earlyStartDays({ status: "draft", today: "2026-10-12", startDate: "2026-10-19" })).toBe(0);
  });
  it("shiftChoiceText: 당기기는 종료일까지 n일, 그대로는 첫 회차까지 진행 중인 회차가 없다", () => {
    const t = shiftChoiceText(7, "2026-10-19");
    expect(t.shift.label).toBe("일정을 오늘부터 당기기");
    expect(t.shift.note).toBe("모든 회차·과제·개인 목표와 종료일도 7일 당겨져요 · 전체 기간은 그대로예요");
    expect(t.keep.label).toBe("일정 그대로");
    expect(t.keep.note).toBe("시작일만 오늘로 바뀌어요 · 10.19 전까지는 진행 중인 회차가 없어요");
  });
  it("startDoneText: 당긴 날수와 담당자 없는 과제 수(기간 밖 경고는 세지 않는다)", () => {
    const w = [{ code: "UNASSIGNED_TASK", nodeId: "1" }, { code: "PERIOD_OUTSIDE_ROOM", nodeId: "2" }] as never;
    expect(startDoneText({ warnings: w, shift: { days: 7, nodes: 12 } })).toBe("스터디를 시작했어요 · 일정을 7일 당겼어요 · 담당자 없는 과제 1개");
    expect(startDoneText({ warnings: [], shift: { days: 0, nodes: 0 } })).toBe("스터디를 시작했어요");
    expect(startDoneText({ warnings: [] })).toBe("스터디를 시작했어요");
  });
});

// 0025 — 방 알림 설정(settings_get/put). 제출 하루 요약(submissionDigest)을 끌 수 있다 (오케스트레이터 결정)
describe("방 알림 설정", () => {
  it("settings_get / settings_put — 전체 값을 넘긴다", async () => {
    const { calls, client } = fake();
    const s = { reminderD1: true, reminderD3: false, taskAssigned: true, scheduleChanged: true, roomStartEnd: true, completionMode: "daily" as const, submissionDigest: false };
    await fetchNotifySettings("r1", client);
    await putNotifySettings("r1", s, client);
    expect(calls).toEqual([["settings_get", { p_slug: "r1" }], ["settings_put", { p_slug: "r1", p_settings: s }]]);
  });
  it("NOTIFY_ROWS: 제출 하루 요약 줄이 있고 그룹장에게만 간다고 알린다", () => {
    const row = NOTIFY_ROWS.find((r) => r.key === "submissionDigest")!;
    expect(row.title).toBe("팀원 제출 하루 요약");
    expect(row.desc).toBe("어제 들어온 팀원 제출을 매일 오전 9시에 그룹장에게 한 번에 알려요");
  });
});
