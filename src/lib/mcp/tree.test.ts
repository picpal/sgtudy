import { describe, expect, it } from "vitest";
import { toCurriculumTree } from "./tree";

const person = (id: string, nickname: string) => ({ userId: id, nickname, tone: "mint" as const });
const node = (o: Record<string, unknown>) => ({ parentId: null, roundId: "1", depth: 2, sortOrder: 0, label: null, descriptionMd: "", archived: false,
  ownerId: null, task: null, assigned: 0, submitted: 0, pct: null, startDate: "2026-11-01", endDate: "2026-11-07", ...o });
const cur = {
  today: "2026-10-19", version: "v".repeat(32),
  study: { slug: "s", title: "T", intro: "i", startDate: "2026-11-01", endDate: "2026-11-30" },
  room: { slug: "s", status: "draft", leaderDoesTasks: true },
  members: [{ ...person("u1", "민수"), role: "leader", status: "active", doesTasks: true, canEditCurriculum: true }],
  nodes: [
    node({ id: "1", label: "1주차", title: "R1" }),
    node({ id: "2", parentId: "1", depth: 3, title: "묶음" }),
    node({ id: "3", parentId: "2", depth: 4, title: "T1", task: { type: "designated", people: [{ ...person("u1", "민수"), status: "OPEN" }], assigned: 1, submitted: 0, state: "planned" }, assigned: 1 }),
    node({ id: "4", parentId: "1", depth: 3, title: "내 목표", ownerId: "u1", task: { type: "personal", people: [], assigned: 1, submitted: 0, state: "planned" } }),
    node({ id: "5", parentId: "1", depth: 3, title: "보관", archived: true, task: { type: "common", people: [], assigned: 0, submitted: 0, state: "planned" } }),
  ],
  stats: { overallPct: null, leafCount: 1, unassignedCount: 0 },
  myPermissions: { canEditCurriculum: true }, personal: { canAdd: false, perRound: 20 },
};

describe("toCurriculumTree", () => {
  it("v1 트리: kind·중첩·assignees·보관 제외·설명 생략", () => {
    const t = toCurriculumTree(cur as never, { includeDescriptions: false });
    expect(t.schema).toBe("sgtudy.curriculum/v1");
    expect(t.rounds).toHaveLength(1);
    const r = t.rounds[0];
    expect([r.kind, r.label, r.children.map((c) => c.kind)]).toEqual(["round", "1주차", ["bundle", "personal"]]);
    expect(r.children[0].children[0]).toMatchObject({ id: "3", kind: "task", taskType: "designated", assignees: ["u1"] });
    expect("descriptionMd" in r).toBe(false);
    expect(t.constraints.maxDepth).toBe(5);
    expect(t.me).toEqual({ canEditCurriculum: true, canAddPersonal: false, personalPerRound: 20 });
  });
  it("includeDescriptions → 2,000자 절단", () => {
    const long = { ...cur, nodes: [node({ id: "1", title: "R", descriptionMd: "가".repeat(2500) })] };
    const t = toCurriculumTree(long as never, { includeDescriptions: true });
    expect(t.rounds[0].descriptionMd!.length).toBe(2001);   // 2000 + '…'
  });
  it("includeArchived → 보관 노드 archived 표시 · 회차 리프 taskType · 개인 목표 progress 생략·ownerNickname(멤버 목록)", () => {
    const c = { ...cur, nodes: [...cur.nodes, node({ id: "6", label: "2주차", title: "R2", task: { type: "common", people: [], assigned: 0, submitted: 0, state: "planned" } })] };
    const t = toCurriculumTree(c as never, { includeDescriptions: false, includeArchived: true });
    const [r1, r2] = t.rounds;
    expect(r1.children.map((x) => [x.id, x.archived ?? false])).toEqual([["2", false], ["4", false], ["5", true]]);
    expect(r2).toMatchObject({ kind: "round", taskType: "common" });
    const mine = r1.children[1];
    expect(mine).toMatchObject({ kind: "personal", ownerId: "u1", ownerNickname: "민수" });
    expect("progress" in mine).toBe(false);
    expect("isMine" in mine).toBe(false);                    // 게이트웨이 값이 없으면 만들지 않는다(〔C#5〕)
  });
  it("보관된 부모의 하위는 함께 빠진다 · currentRoundId·fileCounts·isMine 반영", () => {
    const c = {
      ...cur, currentRoundId: "1", fileCounts: { "3": 2 },
      nodes: cur.nodes.map((n: Record<string, unknown>) => (n.id === "2" ? { ...n, archived: true } : n.id === "4" ? { ...n, isMine: true } : n)),
    };
    const t = toCurriculumTree(c as never, { includeDescriptions: false });
    expect(t.rounds[0].current).toBe(true);
    expect(t.rounds[0].children.map((x) => x.id)).toEqual(["4"]);
    expect(t.rounds[0].children[0].isMine).toBe(true);
    const all = toCurriculumTree(c as never, { includeDescriptions: false, includeArchived: true });
    expect(all.rounds[0].children[0].children[0].files).toBe(2);
  });
});
