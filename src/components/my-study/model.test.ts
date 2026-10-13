import { describe, expect, it } from "vitest";
import { AWS, REF_DAY } from "./fixtures";
import { EMPTY_OVERRIDES, buildTree, dropFieldOv, isDirty, memberStats, overallPct, periodWarnings, stripFieldOv, unassignedCount } from "./model";

describe("buildTree archive bookkeeping (final batch)", () => {
  it("subAll counts submissions under archived children; sub does not", () => {
    const cur = { ...AWS, nodes: AWS.nodes.map((n) => (n.id === "11" ? { ...n, archived: true } : n)) };
    const r1 = buildTree(cur, EMPTY_OVERRIDES, REF_DAY).roots[0];
    expect(r1.sub).toBe(2);        // 12 만 (11 보관)
    expect(r1.subAll).toBe(5);     // 11 의 3건 포함 → 삭제가 아니라 보관
  });
  it("archivedByParent only for nodes hidden by an archived ancestor", () => {
    const cur = { ...AWS, nodes: AWS.nodes.map((n) => (n.id === "31" ? { ...n, archived: true } : n)) };
    const t = buildTree(cur, EMPTY_OVERRIDES, REF_DAY);
    const own = t.nodes.find((n) => n.id === "31")!;
    const child = t.nodes.find((n) => n.id === "311")!;
    expect([own.archived, own.archivedByParent]).toEqual([true, false]);
    expect([child.archived, child.archivedByParent]).toEqual([true, true]);
  });
});

describe("buildTree from Curriculum (mystudy §3.3 목업 회귀값)", () => {
  const t = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
  it("aggregates: roots 63/33/0/0/0, overall 24, 8 leaves, members exclude 이탈자", () => {
    expect(t.roots.map((r) => r.pct)).toEqual([63, 33, 0, 0, 0]);
    expect(t.roots.map((r) => [r.sub, r.asg])).toEqual([[5, 8], [1, 3], [0, 4], [0, 4], [0, 6]]);
    expect(overallPct(t.roots)).toBe(24);
    expect(t.leaves).toHaveLength(8);
    expect(t.members.map((m) => m.name)).toEqual(["민수", "지은", "철수", "하나"]);
    expect(unassignedCount(t.leaves)).toBe(0);
  });
  it("depth, crumb, roundId, roundLabel on a 5단계 leaf", () => {
    const alb = t.leaves.find((l) => l.id === "311")!;
    expect(alb.d).toBe(2);
    expect(alb.crumb).toBe("3주차 고가용성 아키텍처 › 로드밸런서 비교");
    expect(alb.roundId).toBe("3");
    expect(alb.roundLabel).toBe("3주차");
    expect(alb.state).toBe("planned");
    expect(t.leaves.find((l) => l.id === "11")!.state).toBe("delayed");
    expect(t.leaves.find((l) => l.id === "21")!.state).toBe("progress");
  });
  it("memberStats by userId: 철수 2/6", () => {
    expect(memberStats(t.leaves, "u1")).toEqual({ done: 2, total: 6 });
    expect(memberStats(t.leaves, "u4")).toEqual({ done: 0, total: 7 });
  });
  it("pre-order nodes", () => {
    expect(t.nodes.slice(0, 5).map((n) => n.id)).toEqual(["1", "11", "12", "2", "21"]);
  });
});

describe("buildTree with overrides (optimistic edits)", () => {
  it("assignOv narrows designated assignees by userId, keeping known codes", () => {
    const t = buildTree(AWS, { ...EMPTY_OVERRIDES, assignOv: { "21": ["u1"] } }, REF_DAY);
    expect(t.leaves.find((l) => l.id === "21")!.people).toEqual([{ userId: "u1", name: "철수", tone: "blue", c: "O" }]);
  });
  it("typeOv 공통 assigns every doer, fresh codes O/P by date", () => {
    const t = buildTree(AWS, { ...EMPTY_OVERRIDES, typeOv: { "21": "공통" } }, REF_DAY);
    const l = t.leaves.find((x) => x.id === "21")!;
    expect(l.people.map((p) => [p.name, p.c])).toEqual([["민수", "O"], ["지은", "D"], ["철수", "O"], ["하나", "O"]]);
    expect([l.sub, l.asg]).toEqual([1, 4]);
  });
  it("added child shows as temp leaf, removed hides, archived excludes from totals", () => {
    const t = buildTree(AWS, { ...EMPTY_OVERRIDES, added: { "2": ["새 과제"] }, removed: { "22": true }, archived: { "1": true } }, REF_DAY);
    const r2 = t.roots[1];
    expect(r2.childCount).toBe(3);
    expect(r2.kids.map((k) => k.id)).toEqual(["21", "2.new0"]);
    expect((r2.kids[1] as { people: unknown[] }).people).toHaveLength(4);
    expect(t.roots[0].archived).toBe(true);
    expect(overallPct(t.roots)).toBe(5); // 1주차 보관 제외: 2주차 1/6 (EC2 1/2 + 새 과제 0/4, S3 삭제) + 0/4 + 0/4 + 0/6 = 1/20
  });
  it("added round appends a temp root after the last round", () => {
    const t = buildTree(AWS, { ...EMPTY_OVERRIDES, added: { root: ["새 회차"] } }, REF_DAY);
    expect(t.rootCount).toBe(6);
    expect(t.roots[5]).toMatchObject({ id: "root.new0", label: "6주차", s: "2026-11-05", e: "2026-11-11", kids: [] });   // 서버 기본 라벨 "{n}주차"(D14)와 같게 — 응답 후 깜빡임 없음
  });
});

describe("per-node dirty overrides (Q2-05)", () => {
  const ov = { ...EMPTY_OVERRIDES, titles: { "21": "바뀐 제목" }, dates: { "12": { e: "2026-10-09" } }, added: { root: ["새 회차"] }, removed: { "22": true } };
  it("isDirty only for field edits of that node", () => {
    expect(isDirty(ov, "21")).toBe(true);
    expect(isDirty(ov, "12")).toBe(true);
    expect(isDirty(ov, "11")).toBe(false);
    expect(isDirty(ov, "22")).toBe(false); // 구조 변경은 즉시 RPC — 미저장 아님
    expect(isDirty(ov, null)).toBe(false);
  });
  it("dropFieldOv discards one node's field edits, keeps others and structure", () => {
    const d = dropFieldOv(ov, "21");
    expect(d.titles).toEqual({});
    expect(d.dates).toEqual({ "12": { e: "2026-10-09" } });
    expect(d.added).toEqual({ root: ["새 회차"] });
  });
  it("stripFieldOv keeps only structural overrides — other tabs never show unsaved values", () => {
    const s = stripFieldOv(ov);
    expect(s).toEqual({ ...EMPTY_OVERRIDES, added: { root: ["새 회차"] }, removed: { "22": true } });
    const t = buildTree(AWS, s, REF_DAY);
    expect(t.nodes.find((n) => n.id === "21")!.title).toBe("EC2 인스턴스 유형 정리");
  });
  it("tree nodes carry parentId", () => {
    const t = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
    expect(t.nodes.find((n) => n.id === "311")!.parentId).toBe("31");
    expect(t.nodes.find((n) => n.id === "1")!.parentId).toBeNull();
  });
});

describe("periodWarnings (E4, Q1-10/Q2-21) — 경고만, 막지 않는다", () => {
  const room = { start: "2026-10-01", end: "2026-11-04" };
  it("inside parent and room → none", () => {
    expect(periodWarnings({ s: "2026-10-08", e: "2026-10-14" }, { s: "2026-10-08", e: "2026-10-14" }, room)).toEqual([]);
  });
  it("child outside parent period", () => {
    expect(periodWarnings({ s: "2026-11-09", e: "2026-11-30" }, { s: "2026-11-09", e: "2026-11-15" }, room)).toEqual([
      "상위 항목 기간(11.09 – 11.15)을 벗어났어요",
      "방 기간(10.01 – 11.04)을 벗어났어요",
    ]);
  });
  it("root outside room period (회차 추가 beyond room end)", () => {
    expect(periodWarnings({ s: "2026-11-05", e: "2026-11-11" }, null, room)).toEqual(["방 기간(10.01 – 11.04)을 벗어났어요"]);
  });
});
