import { describe, expect, it } from "vitest";
import {
  dateFmt, expiryNotice, formatApply, formatCurriculum, formatPersonalResult, formatPreview, formatRemoveResult, formatStudies, formatTasks,
  MAX_TEXT, weekWindow,
} from "./format";
import type { ApplyData, PreviewData, StudiesData, WhoamiData } from "./format";
import type { GatewayCurriculum } from "./tree";
import type { ScheduleResponse } from "@/lib/api/types";

describe("dateFmt", () => {
  it("한 해 안 → MM-DD · 해 넘김 → YYYY-MM-DD", () => {
    expect(dateFmt("2026-10-15", { startDate: "2026-10-01", endDate: "2026-12-24" })).toBe("10-15");
    expect(dateFmt("2027-01-05", { startDate: "2026-12-01", endDate: "2027-02-28" })).toBe("2027-01-05");
  });
  it("기간과 다른 해의 날짜는 전체", () => expect(dateFmt("2027-01-02", { startDate: "2026-10-01", endDate: "2026-12-24" })).toBe("2027-01-02"));
});
describe("weekWindow", () => {
  it("KST 월~일 · 놓친 것은 오늘−14 부터", () =>
    expect(weekWindow("2026-10-21", "this_week")).toEqual({ from: "2026-10-19", to: "2026-10-25", fetchFrom: "2026-10-07" }));
  it("일요일도 그 주 월요일부터 · today · next_week · {from,to}", () => {
    expect(weekWindow("2026-10-25", "this_week")).toMatchObject({ from: "2026-10-19", to: "2026-10-25" });
    expect(weekWindow("2026-10-21", "today")).toEqual({ from: "2026-10-21", to: "2026-10-21", fetchFrom: "2026-10-07" });
    expect(weekWindow("2026-10-21", "next_week")).toEqual({ from: "2026-10-26", to: "2026-11-01", fetchFrom: "2026-10-07" });
    expect(weekWindow("2026-10-21", { from: "2026-11-01", to: "2026-11-10" })).toEqual({ from: "2026-11-01", to: "2026-11-10", fetchFrom: "2026-10-07" });
  });
});
describe("formatCurriculum", () => {
  it("개요: 머리 줄 · 회차 1줄씩(id 앞) · 현재 표시 · uuid 없음", () => {
    const text = formatCurriculum(fixtureCurriculum(), { detail: "outline", personal: "mine" });
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^aws \| .* \| 오늘 2026-10-19\(월\) \| v [0-9a-f]{8}$/);
    expect(lines[1]).toBe("나: 편집 가능 · 개인 목표 회차당 20 | 멤버: 민수(그룹장) 지은 민호");
    expect(lines[2]).toBe("회차 3 — id 라벨 제목 기간 · 과제 수 · 제출/배정");
    expect(lines[3]).toBe("201 1주차 IAM·VPC 10-01~10-07 · 과제 1 · 3/4");
    expect(lines[5]).toBe("203 3주차 고가용성 아키텍처 10-15~10-21 · 과제 2 · 1/5 · 내 목표 1 ← 현재");
    expect(text).toContain("← 현재");
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
  it("상세: 현재 회차 하위 · [묶음]/[공통]/[지정: 닉네임] · 내 목표 한 줄 · 남의 목표 없음", () => {
    const text = formatCurriculum(fixtureCurriculum(), { detail: "full", rounds: "current", personal: "mine" });
    expect(text).toContain("[지정: 지은]");
    expect(text).toContain("[내 목표]");
    expect(text).not.toContain("민호의 목표");
    const body = text.split("\n").slice(2);
    expect(body).toEqual([
      "203 3주차 고가용성 아키텍처 10-15~10-21 · 과제 2 · 1/5 · 내 목표 1 ← 현재",
      "  301 [묶음] 로드밸런서 비교",
      "    302 [공통] ALB vs NLB 실습 ~10-20 · 1/4 · 첨부 1",
      "  303 [지정: 지은] 아키텍처 발표 10-21 · 0/1",
      "  [내 목표] 305 복습 노트 ✓   (남은 자리 19)",
    ]);
  });
  it("personal all → 닉네임별 줄 · none → 없음 · isMine 없는 노드는 mine 에서 빠진다(〔C#5〕)", () => {
    const all = formatCurriculum(fixtureCurriculum(), { detail: "full", rounds: 3, personal: "all" });
    expect(all).toContain("  [민호의 목표] 306 퀴즈 오답");
    expect(all).toContain("  [내 목표] 305 복습 노트 ✓");
    expect(formatCurriculum(fixtureCurriculum(), { detail: "full", personal: "none" })).not.toContain("목표]");
    const c = fixtureCurriculum();
    c.nodes = c.nodes.map((n) => { const { isMine: _x, ...rest } = n; void _x; return rest; });
    expect(formatCurriculum(c, { detail: "full", personal: "mine" })).toContain("[내 목표] 없음");
  });
  it("회차 선택자: 서수 · 라벨 · id · 범위 · 없는 것 → ROUND_NOT_FOUND", () => {
    const first = (sel: string | number) => formatCurriculum(fixtureCurriculum(), { detail: "full", rounds: sel, personal: "none" }).split("\n")[2];
    expect(first(1)).toMatch(/^201 1주차/);
    expect(first("2주차")).toMatch(/^202 2주차/);
    expect(first("203")).toMatch(/^203 3주차/);
    expect(formatCurriculum(fixtureCurriculum(), { detail: "outline", rounds: "2-3", personal: "none" }).split("\n").slice(3).map((l) => l.split(" ")[0])).toEqual(["202", "203"]);
    const err = formatCurriculum(fixtureCurriculum(), { detail: "full", rounds: "9주차", personal: "none" });
    expect(err).toMatch(/^오류 ROUND_NOT_FOUND: /);
    expect(err).toContain("후보: 1주차, 2주차, 3주차");
  });
  it("설명 포함 · 보관 표시", () => {
    const c = fixtureCurriculum();
    c.nodes = c.nodes.map((n) => (n.id === "302" ? { ...n, descriptionMd: "줄1\n줄2" } : n));
    c.nodes.push({ ...c.nodes.find((n) => n.id === "303")!, id: "309", title: "옛 과제", archived: true });
    const text = formatCurriculum(c, { detail: "full", personal: "none", includeDescriptions: true, includeArchived: true });
    expect(text).toContain("      > 줄1\n      > 줄2");
    expect(text).toContain("  309 [보관] [지정: 지은] 옛 과제");
  });
  it("상한 8,000자 초과 → 절단 안내", () => {
    const text = formatCurriculum(fixtureCurriculum({ rounds: 400 }), { detail: "outline", personal: "none" });
    expect(text.length).toBeLessThanOrEqual(MAX_TEXT);
    expect(text).toMatch(/외 \d+줄 — rounds:/);
  });
  it("12주 대표 방 개요 ≤ 1,500자(Review Focus 9)", () =>
    expect(formatCurriculum(fixtureCurriculum({ rounds: 12 }), { detail: "outline", personal: "mine" }).length).toBeLessThanOrEqual(1500));
  it("빈 진행목표", () =>
    expect(formatCurriculum({ ...fixtureCurriculum(), nodes: [], currentRoundId: null }, { detail: "full", personal: "mine" }).split("\n")[2]).toBe("회차 0 — 진행목표가 비어 있어요"));
});
describe("formatStudies · formatTasks · formatPreview · expiryNotice", () => {
  it("스터디 1줄씩: slug | 제목 | 역할·편집 | 기간 | 현재 회차", () => {
    const t = formatStudies(fixtureStudies(), fixtureWhoami());
    expect(t).toMatch(/^나: 민수 · 토큰 "test"/);
    expect(t.split("\n")[1]).toBe("aws | AWS SAA 자격증 3개월 완주 | 그룹장·편집 | 10-01~12-24 | 현재 3주차 고가용성 아키텍처");
    expect(t.split("\n")[2]).toBe("sqld | SQLD 2주 완성 | 멤버 · 모집 중 | 11-01~11-14 | 현재 회차 없음");
  });
  it("이번 주 + 놓친 것 분리", () => {
    const t = formatTasks(fixtureSchedule(), weekWindow("2026-10-21", "this_week"));
    expect(t).toMatch(/^이번 주 10-19\(월\)~10-25\(일\)/);
    expect(t).toContain("놓친 것(최근 14일)");
    expect(t.split("\n")).toEqual([
      "이번 주 10-19(월)~10-25(일) · 오늘 10-21(수)",
      "aws · 3주차",
      "  302 [팀 과제] ALB vs NLB 실습 ~10-20(화) 진행 중",
      "  306 [내 목표] 퀴즈 오답 정리 ~10-21(수) 예정",
      "sqld · 2주차",
      "  512 [팀 과제] 정규화 발표 ~10-24(토) 제출",
      "놓친 것(최근 14일)",
      "  aws 2주차 211 [팀 과제] S3 버전 관리 ~10-14(수) 미제출",
    ]);
    expect(t.length).toBeLessThanOrEqual(2000);
  });
  it("미리보기 요약: 한국어 머리 · 40줄 상한 · previewId · 다음 행동", () => {
    const t = formatPreview(fixturePreview({ diff: 60 }), { slug: "aws" });
    expect(t).toMatch(/^미리보기 · aws \(아직 적용 전\)/);
    expect(t).toContain("… 외 20건");
    expect(t).toMatch(/→ 다음: 사용자 승인 후 apply_curriculum_plan\(previewId:"pv_[0-9a-f]{12}"\)$/);
  });
  it("미리보기 줄: + 생성(들여쓰기) · ~ 변경 · ↪ 이동 · 경고 문구 · 알림 · 되돌리기", () => {
    const lines = formatPreview(fixturePreview(), { slug: "aws", titles: { "203": "3주차 고가용성 아키텍처" } }).split("\n");
    expect(lines[0]).toBe("미리보기 · aws (아직 적용 전) — 생성 2 · 변경 1(하위 3건 함께 이동) · 이동 1");
    expect(lines).toContain("+ [묶음] 발표 준비 10-22~10-28 (상위: 3주차 고가용성 아키텍처)");
    expect(lines).toContain("  + [지정: 지은, 민호] 슬라이드 10-22~10-28");
    expect(lines).toContain("~ [회차] 고가용성 아키텍처: 기간 10-15~10-21 → 10-22~10-28 · 담당 지은 → 지은, 민호");
    expect(lines).toContain("↪ [과제] 옮길 과제 → 상위: 3주차 고가용성 아키텍처, 1번째");
    expect(lines).toContain("경고 ops[1]: 상위 항목 기간 밖이에요");
    expect(lines).toContain("경고 ops[2]: 담당자가 없는 지정 과제예요");    // message 가 없어도 WARN_TEXT
    expect(lines).toContain("알림: 지은 1건(묶음) · 민호 1건(새 과제 1)");
    expect(lines).toContain("되돌리기 가능: 일정 4건(하위·개인 목표 포함) · 웹에서만: 생성 2 · 이동 1");
  });
  it("미리보기 실패(ok:false) → 경로별 오류 + 고쳐 다시", () => {
    const t = formatPreview({ ok: false, diff: [], warnings: [], errors: [{ path: "ops[0]", code: "INVALID_TITLE", message: "제목을 넣어 주세요", field: "title" }], notifications: null }, { slug: "aws" });
    expect(t.split("\n")).toEqual([
      "미리보기 실패 · aws — 오류 1건(아무것도 바뀌지 않았어요)",
      "- ops[0] title INVALID_TITLE: 제목을 넣어 주세요",
      "→ 다음: 표시한 경로를 고쳐 preview_curriculum_plan 을 다시 부르세요",
    ]);
  });
  it("되돌리기 미리보기 → ↩ 줄", () => {
    const t = formatPreview({ ...fixturePreview(), undoOf: "pv_aaaaaaaaaaaa", summary: { created: 0, updated: 0, moved: 0, restored: 1, shiftedDescendants: 0 },
      diff: [{ op: "restore", path: "undo", id: "203", kind: "round", title: "고가용성 아키텍처", changes: { startDate: ["2026-10-22", "2026-10-15"], endDate: ["2026-10-28", "2026-10-21"] } }] }, { slug: "aws" });
    expect(t).toMatch(/^미리보기 · aws \(아직 적용 전\) — 되돌리기 pv_aaaaaaaaaaaa · 날짜 복원 1/);
    expect(t).toContain("↩ 날짜 복원 고가용성 아키텍처 10-22~10-28 → 10-15~10-21");
    expect(t).not.toContain("되돌리기 가능");
  });
  it("적용 결과 · 개인 목표 결과 · 삭제 결과", () => {
    const a = formatApply(fixtureApply(), { slug: "aws", origin: "https://sgtudy.app" });
    expect(a.split("\n")).toEqual([
      "적용 완료 — aws 진행목표: 생성 2 · 변경 1(하위 3건 함께 이동) · 이동 1 · 알림 2명",
      "https://sgtudy.app/my-study/aws?tab=curriculum",
      "ref: prep=310 · slides=311",
      "되돌리려면 preview_curriculum_plan(study:\"aws\", undo:\"pv_0123456789ab\") — 일정만, 그 뒤 일정이 바뀌면 거부",
      "이동·생성·제목 등은 웹에서 고쳐야 해요",
    ]);
    expect(formatApply({ ...fixtureApply(), replayed: true }, { slug: "aws", origin: "https://sgtudy.app" })).toMatch(/^이미 적용됨\(같은 previewId\) — /);
    expect(formatPersonalResult({ count: 2, createdIds: ["401", "402"], remaining: 18, round: { id: "203", label: "3주차", title: "고가용성" }, skipped: ["복습"],
      warnings: [{ code: "PERIOD_OUTSIDE_PARENT", nodeId: "402" }] }))
      .toBe("2개 추가(3주차, 남은 자리 18) · 건너뜀(중복) 1: 복습 · id 401, 402 · 경고 402: 상위 항목 기간 밖이에요");
    expect(formatRemoveResult({ deleted: 2, skipped: [] })).toBe("2개 삭제");
    expect(formatRemoveResult({ deleted: 1, skipped: ["9"] })).toBe("1개 삭제 · 이미 없음 1개");
  });
  it("만료 7일 이내만 안내", () => {
    expect(expiryNotice("2026-10-24T00:00:00Z", "2026-10-19")).toMatch(/5일 뒤 만료/);
    expect(expiryNotice("2026-12-24T00:00:00Z", "2026-10-19")).toBeNull();
    expect(expiryNotice(null, "2026-10-19")).toBeNull();
  });
});

/* ---------- fixtures (tree.test.ts 의 cur 를 확장 — 멤버 지은·민호, 지정 과제 1, 민수·민호의 개인 목표) ---------- */
// 실제 SQL 응답 모양과의 일치는 contract.test.ts 가 따로 본다
type N = GatewayCurriculum["nodes"][number];
const person = (userId: string, nickname: string) => ({ userId, nickname, tone: "mint" as const });
const U = { 민수: person("11111111-1111-4111-8111-111111111111", "민수"), 지은: person("22222222-2222-4222-8222-222222222222", "지은"),
  민호: person("33333333-3333-4333-8333-333333333333", "민호") };
const node = (o: Partial<N> & { id: string; title: string }): N => ({
  parentId: null, roundId: o.id, depth: 2, sortOrder: 0, label: null, descriptionMd: "", archived: false, ownerId: null, task: null,
  assigned: 0, submitted: 0, pct: null, startDate: "2026-10-15", endDate: "2026-10-21", isMine: false, ...o,
});
const team = (type: "common" | "designated", people: (keyof typeof U)[], submitted = 0) =>
  ({ type, people: people.map((p, i) => ({ ...U[p], status: (i < submitted ? "done" : "open") as "done" | "open" })), assigned: people.length, submitted, state: "progress" as const });
const goal = (owner: keyof typeof U, done: boolean) =>
  ({ type: "personal" as const, people: [{ ...U[owner], status: (done ? "done" : "open") as "done" | "open" }], assigned: 1, submitted: done ? 1 : 0, state: "progress" as const });

function fixtureCurriculum(o: { rounds?: number } = {}): GatewayCurriculum {
  const base = {
    today: "2026-10-19", version: "9f2c41ab" + "0".repeat(24),
    study: { slug: "aws", title: "AWS SAA 자격증 3개월 완주", status: "active" as const, startDate: "2026-10-01", endDate: "2026-12-24" },
    room: { slug: "aws", status: "active" as const, leaderDoesTasks: true },
    members: [
      { ...U.민수, role: "leader" as const, status: "active" as const, doesTasks: true, canEditCurriculum: true },
      { ...U.지은, role: "member" as const, status: "active" as const, doesTasks: true, canEditCurriculum: false },
      { ...U.민호, role: "member" as const, status: "active" as const, doesTasks: true, canEditCurriculum: false },
    ],
    stats: { overallPct: 40, leafCount: 4, unassignedCount: 0 },
    myPermissions: { canEditCurriculum: true }, personal: { canAdd: true, perRound: 20 },
    currentRoundId: "203", fileCounts: { "302": 1 }, viewer: { nickname: "민수" },
  };
  if (o.rounds) {
    const nodes: N[] = [];
    for (let i = 0; i < o.rounds; i++) {
      const id = String(1000 + i * 10);
      nodes.push(node({ id, label: `${i + 1}주차`, title: `회차 주제 ${i + 1}`, sortOrder: i, startDate: "2026-10-01", endDate: "2026-10-07", assigned: 24, submitted: 12 }));
      for (let k = 1; k <= 4; k++) nodes.push(node({ id: String(Number(id) + k), parentId: id, roundId: id, depth: 3, title: `과제 ${k}`, task: team("common", ["민수", "지은", "민호"]), assigned: 3 }));
    }
    return { ...base, currentRoundId: "1000", nodes };
  }
  return {
    ...base,
    nodes: [
      node({ id: "201", label: "1주차", title: "IAM·VPC", startDate: "2026-10-01", endDate: "2026-10-07", assigned: 4, submitted: 3 }),
      node({ id: "211", parentId: "201", roundId: "201", depth: 3, title: "IAM 실습", startDate: "2026-10-01", endDate: "2026-10-07", task: team("common", ["민수", "지은", "민호"], 3), assigned: 4, submitted: 3 }),
      node({ id: "202", label: "2주차", title: "EC2·S3", sortOrder: 1, startDate: "2026-10-08", endDate: "2026-10-14" }),
      node({ id: "203", label: "3주차", title: "고가용성 아키텍처", sortOrder: 2, assigned: 5, submitted: 1 }),
      node({ id: "301", parentId: "203", roundId: "203", depth: 3, title: "로드밸런서 비교", assigned: 4, submitted: 1 }),
      node({ id: "302", parentId: "301", roundId: "203", depth: 4, title: "ALB vs NLB 실습", endDate: "2026-10-20", task: team("common", ["민수", "지은", "민호"], 1), assigned: 4, submitted: 1 }),
      node({ id: "303", parentId: "203", roundId: "203", depth: 3, title: "아키텍처 발표", startDate: "2026-10-21", task: team("designated", ["지은"]), assigned: 1 }),
      node({ id: "305", parentId: "203", roundId: "203", depth: 3, title: "복습 노트", ownerId: U.민수.userId, isMine: true, task: goal("민수", true) }),
      node({ id: "306", parentId: "203", roundId: "203", depth: 3, title: "퀴즈 오답", ownerId: U.민호.userId, isMine: false, task: goal("민호", false) }),
    ],
  };
}

const fixtureWhoami = (): WhoamiData => ({ nickname: "민수", source: "pat", tokenName: "test", scopes: ["curriculum:write", "personal:write", "read"], expiresAt: "2027-01-17T00:00:00Z" });
const fixtureStudies = (): StudiesData => ({
  today: "2026-10-19",
  items: [
    { slug: "aws", title: "AWS SAA 자격증 3개월 완주", status: "active", role: "leader", canEditCurriculum: true, canAddPersonal: true, startDate: "2026-10-01", endDate: "2026-12-24",
      currentRound: { id: "203", label: "3주차", title: "고가용성 아키텍처", startDate: "2026-10-15", endDate: "2026-10-21" } },
    { slug: "sqld", title: "SQLD 2주 완성", status: "recruit", role: "member", canEditCurriculum: false, canAddPersonal: false, startDate: "2026-11-01", endDate: "2026-11-14", currentRound: null },
  ],
});
const fixtureSchedule = (): ScheduleResponse => ({
  today: "2026-10-21",
  studies: [],
  markers: [],
  upcoming: [],
  tasks: [
    { id: "211", slug: "aws", title: "S3 버전 관리", s: "2026-10-08", e: "2026-10-14", st: "missed", round: "2주차" },
    { id: "212", slug: "aws", title: "제출한 옛 과제", s: "2026-10-08", e: "2026-10-14", st: "done", round: "2주차" },
    { id: "302", slug: "aws", title: "ALB vs NLB 실습", s: "2026-10-15", e: "2026-10-20", st: "open", round: "3주차" },
    { id: "306", slug: "aws", title: "퀴즈 오답 정리", s: "2026-10-15", e: "2026-10-21", st: "planned", round: "3주차", personal: true },
    { id: "512", slug: "sqld", title: "정규화 발표", s: "2026-10-20", e: "2026-10-24", st: "done", round: "2주차" },
    { id: "601", slug: "aws", title: "다음 주 과제", s: "2026-10-26", e: "2026-10-30", st: "planned", round: "4주차" },
  ],
});
function fixturePreview(o: { diff?: number } = {}): PreviewData {
  const diff: PreviewData["diff"] = o.diff
    ? Array.from({ length: o.diff }, (_, i) => ({ op: "update", path: `ops[${i}]`, id: String(500 + i), kind: "task", title: `과제 ${i}`,
        changes: { endDate: ["2026-10-20", "2026-10-21"] } }))
    : [
        { op: "create", path: "ops[0]", ref: "prep", id: null, kind: "bundle", title: "발표 준비", label: null, taskType: null, startDate: "2026-10-22", endDate: "2026-10-28", parent: "203", parentPath: null },
        { op: "create", path: "ops[0].children[0]", ref: null, id: null, kind: "task", title: "슬라이드", label: null, taskType: "designated", startDate: "2026-10-22", endDate: "2026-10-28", parent: null, parentPath: "ops[0]", assignees: ["지은", "민호"] },
        { op: "update", path: "ops[1]", id: "203", kind: "round", title: "고가용성 아키텍처",
          changes: { startDate: ["2026-10-15", "2026-10-22"], endDate: ["2026-10-21", "2026-10-28"], assignees: [["지은"], ["지은", "민호"]] } },
        { op: "move", path: "ops[2]", id: "304", kind: "task", title: "옮길 과제", parent: "203", index: 0, from: { parentId: "202", index: 2 } },
      ];
  return {
    ok: true, diff, errors: [], previewId: "pv_7c1e9a40b2d3", expiresAt: "2026-10-20T03:00:00.000Z", version: "9f2c41ab" + "0".repeat(24), undoOf: null,
    summary: { created: 2, updated: 1, moved: 1, restored: 0, shiftedDescendants: 3 },
    warnings: [{ code: "PERIOD_OUTSIDE_PARENT", message: "상위 항목 기간 밖이에요", nodeId: "203", path: "ops[1]" }, { code: "UNASSIGNED_TASK", path: "ops[2]" }],
    notifications: { recipients: 2, perRecipient: [{ nickname: "지은", count: 3, collapsed: true, newTasks: 0 }, { nickname: "민호", count: 1, collapsed: false, newTasks: 1 }] },
    undoable: { ops: 4, notUndoable: { created: 2, moved: 1, otherChanges: 0 } },
  };
}
const fixtureApply = (): ApplyData => ({
  ok: true, applied: true, previewId: "pv_0123456789ab", createdIds: ["310", "311"], refs: { prep: "310", slides: "311" }, link: "/my-study/aws?tab=curriculum",
  summary: { created: 2, updated: 1, moved: 1, restored: 0, shiftedDescendants: 3 },
  notifications: { recipients: 2, perRecipient: [] }, undoable: { ops: 4, notUndoable: { created: 2, moved: 1, otherChanges: 0 } },
});
