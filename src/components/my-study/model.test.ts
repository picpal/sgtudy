import { describe, expect, it } from "vitest";
import { AWS, CHULSU, JIEUN, REF_DAY } from "./fixtures";
import { CODE_LABEL, EMPTY_OVERRIDES, buildTree, codeLabel, descendantCount, dropFieldOv, ganttRange, inScope, isDirty, memberStats, myCode, overallPct, periodWarnings, personalStats, removePlan, thisRoundId, roundStatus, stripFieldOv, unassignedCount, visibleNodes, type ItemScope, type LeafNode } from "./model";

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

describe("ganttRange", () => {
  it("empty curriculum still shows 5 weeks from this week's Sunday (no 1-week stub)", () => {
    expect(ganttRange([], "2026-10-14")).toEqual({ start: "2026-10-11", nDays: 35 });
  });
  it("non-empty: Sunday before the first start to Saturday after the last end", () => {
    const roots = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY).roots;
    const { start, nDays } = ganttRange(roots, REF_DAY);
    expect(new Date(start + "T00:00:00Z").getUTCDay()).toBe(0);
    expect(nDays % 7).toBe(0);
    expect(start <= roots[0].s).toBe(true);
  });
});

describe("removePlan (편집 화면·목록 삭제 공통)", () => {
  // 팀 노드만 — 개인 목표가 섞인 경우는 아래 "개인 목표의 제출도 삭제를 막는다"
  const t = buildTree({ ...AWS, nodes: AWS.nodes.filter((n) => n.task?.type !== "personal") }, EMPTY_OVERRIDES, REF_DAY);
  const node = (id: string) => t.nodes.find((n) => n.id === id)!;
  it("counts every descendant, nested ones included", () => {
    expect(descendantCount(node("3"))).toBe(2); // 31 + 311
    expect(descendantCount(node("311"))).toBe(0);
  });
  it("no submissions → delete, saying how many children go with it", () => {
    expect(removePlan(node("3"))).toEqual({ kind: "delete", label: "삭제", text: "이 항목과 하위 항목 2개를 함께 삭제할까요? 되돌릴 수 없어요." });
    expect(removePlan(node("41"))).toMatchObject({ kind: "delete", text: "이 항목을 삭제할까요? 되돌릴 수 없어요." });
  });
  it("submissions anywhere below → archive instead; already archived → nothing to do", () => {
    expect(removePlan(node("1"))).toMatchObject({ kind: "archive", label: "보관" });
    const cur = { ...AWS, nodes: AWS.nodes.map((n) => (n.id === "1" ? { ...n, archived: true } : n)) };
    expect(removePlan(buildTree(cur, EMPTY_OVERRIDES, REF_DAY).nodes.find((n) => n.id === "1")!).kind).toBe("none");
  });
  it("개인 목표의 제출도 삭제를 막는다(서버 node_has_submissions 와 같게)", () => {
    const full = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
    expect(removePlan(full.nodes.find((n) => n.id === "3")!)).toMatchObject({ kind: "archive", label: "보관" });
  });
  it("개인 목표가 함께 지워지면 확인 문구 끝에 개수 — 하위 항목 수는 팀 항목만", () => {
    // 지은 개인(33)을 완료 전으로 — 제출 없음 → 삭제
    const cur = { ...AWS, nodes: AWS.nodes.map((n) => (n.id === "33" && n.task ? { ...n, task: { ...n.task, people: n.task.people.map((p) => ({ ...p, status: "planned" as const })), submitted: 0 } } : n)) };
    const t3 = buildTree(cur, EMPTY_OVERRIDES, REF_DAY).nodes.find((n) => n.id === "3")!;
    expect(removePlan(t3)).toEqual({ kind: "delete", label: "삭제", text: "이 항목과 하위 항목 2개를 함께 삭제할까요? 되돌릴 수 없어요. 개인 목표 2개도 함께 삭제돼요." });
    // 팀 자식 없이 개인 목표만 있는 회차
    const only = { ...cur, nodes: cur.nodes.filter((n) => !["31", "311"].includes(n.id)) };
    expect(removePlan(buildTree(only, EMPTY_OVERRIDES, REF_DAY).nodes.find((n) => n.id === "3")!)).toMatchObject({ kind: "delete", text: "이 항목을 삭제할까요? 되돌릴 수 없어요. 개인 목표 2개도 함께 삭제돼요." });
  });
});

describe("roundStatus (보기 상세 기간 문구)", () => {
  const r = { s: "2026-10-08", e: "2026-10-14" };
  it("before start", () => expect(roundStatus(r, "2026-10-05")).toBe("시작 D-3"));
  it("in progress", () => expect(roundStatus(r, "2026-10-12")).toBe("진행 중 · 마감 D-2"));
  it("last day", () => expect(roundStatus(r, "2026-10-14")).toBe("진행 중 · 마감 D-DAY"));
  it("ended", () => expect(roundStatus(r, "2026-10-15")).toBe("종료"));
});

describe("개인 목표", () => {
  const t = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
  const r3 = t.roots.find((r) => r.label === "3주차")!;
  it("부모 롤업·leaves 에서 빠진다", () => {
    const team = r3.kids.filter((k) => !(k.leaf && k.personal));
    const sumAsg = team.reduce((a, k) => a + (k.archived ? 0 : k.asg), 0);
    expect(r3.asg).toBe(sumAsg);
    expect(t.leaves.some((l) => l.personal)).toBe(false);
    expect(t.personal.length).toBe(2);
  });
  it("visibleNodes: 팀 먼저, 내 것, (others 면) 남의 것 / 편집 모드엔 없음", () => {
    const sc = { meId: CHULSU, mineOnly: false, others: false, isEdit: false, isLeader: false };
    const rows = visibleNodes(t.roots, {}, sc).filter((n) => n.roundId === r3.id && n.d > 0);
    expect(rows.map((n) => (n.leaf && n.personal ? `P:${n.ownerId}` : "T"))).toEqual(["T", "T", `P:${CHULSU}`]);   // 묶음 + 묶음 안 과제, 철수 개인
    expect(visibleNodes(t.roots, {}, { ...sc, others: true }).some((n) => n.leaf && n.personal && n.ownerId === JIEUN)).toBe(true);
    expect(visibleNodes(t.roots, {}, { ...sc, isEdit: true }).some((n) => n.leaf && n.personal)).toBe(false);
  });
  it("mineOnly: 내게 배정 안 된 팀 과제는 빠진다", () => {
    const rows = visibleNodes(t.roots, {}, { meId: CHULSU, mineOnly: true, others: false, isEdit: false, isLeader: false });
    expect(rows.filter((n) => n.leaf && !n.personal).every((n) => n.leaf && !!myCode(n, CHULSU))).toBe(true);
  });
  it("mineOnly: 내 리프가 하나도 없는 묶음 행은 건너뛴다(회차 행은 남긴다)", () => {
    // 311 에서 철수를 뺀다 → 묶음 31 아래 철수 것이 없다
    const cur = { ...AWS, nodes: AWS.nodes.map((n) => (n.id === "311" && n.task ? { ...n, task: { ...n.task, people: n.task.people.filter((p) => p.userId !== CHULSU) } } : n)) };
    const t2 = buildTree(cur, EMPTY_OVERRIDES, REF_DAY);
    const ids = visibleNodes(t2.roots, {}, { meId: CHULSU, mineOnly: true, others: false, isEdit: false, isLeader: false }).filter((n) => n.roundId === "3").map((n) => n.id);
    expect(ids).toEqual(["3", "32"]);
    // mineOnly 가 아니면 묶음은 그대로
    expect(visibleNodes(t2.roots, {}, { meId: CHULSU, mineOnly: false, others: false, isEdit: false, isLeader: false }).some((n) => n.id === "31")).toBe(true);
  });
  it("codeLabel: 개인 = 기한내 완료/늦게 완료/기한 지남, 팀 = CODE_LABEL", () => {
    const p = t.personal[0];
    const team = t.leaves[0];
    expect([codeLabel(p, "D"), codeLabel(p, "L"), codeLabel(p, "M"), codeLabel(p, "O"), codeLabel(p, "P")]).toEqual(["기한내 완료", "늦게 완료", "기한 지남", CODE_LABEL.O, CODE_LABEL.P]);
    expect([codeLabel(team, "D"), codeLabel(team, "M")]).toEqual([CODE_LABEL.D, CODE_LABEL.M]);
  });
  it("personalStats", () => {
    expect(personalStats(t.personal, JIEUN)).toEqual({ done: 1, total: 1 });
  });

  // ---- 브리프 밖 보강: 경계 규칙 ----
  const sc: ItemScope = { meId: CHULSU, mineOnly: false, others: true, isEdit: false, isLeader: false };
  it("buildTree: 개인 리프 = 유형 개인·ownerId·서버 people, 팀 리프 ownerId null", () => {
    const p = t.personal.find((l) => l.ownerId === JIEUN)!;
    expect([p.type, p.personal, p.people.map((x) => x.userId), p.state]).toEqual(["개인", true, [JIEUN], "complete"]);
    const team = t.leaves[0];
    expect([team.personal, team.ownerId]).toEqual([false, null]);
  });
  it("롤업 수치 불변(팀만) · subAll 은 개인 제출 포함 · childCount 는 모든 자식", () => {
    expect([r3.sub, r3.asg, r3.pct]).toEqual([0, 4, 0]);
    expect(r3.subAll).toBe(1);          // 지은 개인 제출 1건 → 서버 node_has_submissions 와 같게 삭제 대신 보관
    expect(r3.childCount).toBe(3);
  });
  it("visibleNodes 순서: 남의 것은 멤버 순서 → 서버 순서, sc 없으면 개인은 끝", () => {
    const ids = (rows: { id: string; roundId: string }[]) => rows.filter((n) => n.roundId === "3").map((n) => n.id);
    expect(ids(visibleNodes(t.roots, {}, sc))).toEqual(["3", "31", "311", "32", "33"]);
    expect(ids(visibleNodes(t.roots, {}, { ...sc, meId: JIEUN }))).toEqual(["3", "31", "311", "33", "32"]);
    expect(ids(visibleNodes(t.roots, {}))).toEqual(["3", "31", "311", "33", "32"]);
  });
  it("visibleNodes 남의 것: 멤버 순서(Curriculum.members) → 서버 순서", () => {
    const p32 = AWS.nodes.find((n) => n.id === "32")!;
    const hana = { ...p32, id: "34", sortOrder: 4, ownerId: "u4", task: { ...p32.task!, people: [{ userId: "u4", nickname: "하나", tone: "lav" as const, status: "planned" as const }] } };
    const hana2 = { ...hana, id: "35", sortOrder: 0 };
    const two = buildTree({ ...AWS, nodes: [...AWS.nodes, hana, hana2] }, EMPTY_OVERRIDES, REF_DAY);
    const ids = (t2: typeof two) => visibleNodes(t2.roots, {}, { ...sc, meId: "u2" }).filter((n) => n.roundId === "3" && n.d === 1).map((n) => n.id);
    expect(ids(two)).toEqual(["31", "33", "32", "35", "34"]);           // 멤버 순서 민수·지은·철수·하나, 하나 것은 서버 순서
    const reordered = buildTree({ ...AWS, members: [...AWS.members].reverse(), nodes: [...AWS.nodes, hana, hana2] }, EMPTY_OVERRIDES, REF_DAY);
    expect(ids(reordered)).toEqual(["31", "35", "34", "32", "33"]);
  });
  it("inScope: 부모 항상 · 남의 보관 개인은 그룹장만 · 내 보관 개인은 보임", () => {
    const cur = { ...AWS, nodes: AWS.nodes.map((n) => (n.id === "32" || n.id === "33" ? { ...n, archived: true } : n)) };
    const ta = buildTree(cur, EMPTY_OVERRIDES, REF_DAY);
    const mineP = ta.nodes.find((n) => n.id === "32")!;
    const other = ta.nodes.find((n) => n.id === "33")!;
    expect(ta.personal).toHaveLength(0);
    expect(inScope(mineP, sc)).toBe(true);
    expect(inScope(other, sc)).toBe(false);
    expect(inScope(other, { ...sc, isLeader: true })).toBe(true);
    expect(inScope(other, { ...sc, others: false, isLeader: true })).toBe(false);
    expect(inScope(ta.roots[0], { ...sc, mineOnly: true, isEdit: true })).toBe(true);
  });
  it("personalStats: 회차 한정·남의 것 제외", () => {
    expect(personalStats(t.personal, CHULSU)).toEqual({ done: 0, total: 1 });
    expect(personalStats(t.personal, JIEUN, "2")).toEqual({ done: 0, total: 0 });
    expect(personalStats(t.personal, JIEUN, "3")).toEqual({ done: 1, total: 1 });
  });
  it("thisRoundId = me_tasks cur 규칙: 오늘 포함 → 직전 시작 회차 → 아직 시작 전이면 첫 회차 · 보관 회차 제외", () => {
    const roots = t.roots; // 1: 10.01–10.07, 2: 10.08–10.14, 3: 10.15–10.21, 4, 5
    expect(thisRoundId(roots, "2026-10-03")).toBe("1");
    expect(thisRoundId(roots, "2026-10-08")).toBe("2");
    expect(thisRoundId(roots, "2026-01-01")).toBe("1");
    expect(thisRoundId(roots, "2027-12-31")).toBe("5");
    // 공백 구간 → 직전에 시작한 회차
    const gap = roots.map((r) => (r.id === "2" ? { ...r, s: "2026-10-10" } : r));
    expect(thisRoundId(gap, "2026-10-09")).toBe("1");
    // 오늘을 포함하는 회차가 우선 (더 늦게 시작한 회차가 이미 끝났어도)
    const overlap = roots.filter((r) => r.id === "1" || r.id === "2").map((r) => (r.id === "1" ? { ...r, e: "2026-10-30" } : r));
    expect(thisRoundId(overlap, "2026-10-20")).toBe("1");
    // 시작일이 같으면 뒤 순서(sort_order desc)
    const same = roots.filter((r) => r.id === "1" || r.id === "2").map((r) => ({ ...r, s: "2026-10-01", e: "2026-10-30" }));
    expect(thisRoundId(same, "2026-10-05")).toBe("2");
    // 보관 회차 제외 · 회차 없음 null
    expect(thisRoundId(roots.map((r) => (r.id === "2" ? { ...r, archived: true } : r)), "2026-10-10")).toBe("1");
    expect(thisRoundId([], "2026-10-14")).toBeNull();
  });
  it("personalStats(roundId): 개요 멤버 열 — 그 회차의 그 사람 것만, 늦게 완료도 완료, 보관 제외", () => {
    const p33 = AWS.nodes.find((n) => n.id === "33")!;
    const late = { ...p33, id: "36", sortOrder: 5, task: { ...p33.task!, people: [{ ...p33.task!.people[0], status: "late" as const }] } };
    const open = { ...p33, id: "37", sortOrder: 6, task: { ...p33.task!, people: [{ ...p33.task!.people[0], status: "open" as const }] } };
    const arch = { ...p33, id: "38", sortOrder: 7, archived: true };
    const elsewhere = { ...p33, id: "39", roundId: "2", parentId: "2", sortOrder: 9 };
    const tp = buildTree({ ...AWS, nodes: [...AWS.nodes, late, open, arch, elsewhere] }, EMPTY_OVERRIDES, REF_DAY);
    expect(personalStats(tp.personal, JIEUN, "3")).toEqual({ done: 2, total: 3 });
    expect(personalStats(tp.personal, JIEUN, "2")).toEqual({ done: 1, total: 1 });
    expect(personalStats(tp.personal, JIEUN)).toEqual({ done: 3, total: 4 });
    expect(personalStats(tp.personal, CHULSU, "3")).toEqual({ done: 0, total: 1 });
  });
  it("개인 리프는 유형/담당 오버라이드로 다시 계산하지 않는다(편집 대상 아님)", () => {
    const ov = { ...EMPTY_OVERRIDES, typeOv: { "32": "공통" as const }, assignOv: { "32": ["u2", "u3"] } };
    const p = buildTree(AWS, ov, REF_DAY).personal.find((l) => l.id === "32")!;
    expect([p.type, p.people.map((x) => x.userId)]).toEqual(["개인", [CHULSU]]);
  });
});

describe("ownerLeft — 이탈(비활성)한 팀원의 개인 목표", () => {
  const dy = AWS.nodes.find((n) => n.id === "33")!;
  const cur = { ...AWS, nodes: [...AWS.nodes, { ...dy, id: "3d", sortOrder: 9, archived: true, ownerId: "u5", task: { ...dy.task!, people: [{ ...dy.task!.people[0], userId: "u5", nickname: "도윤" }] } }] };
  const t = buildTree(cur, EMPTY_OVERRIDES, REF_DAY);
  const leafOf = (id: string) => t.nodes.find((l) => l.id === id) as LeafNode;
  it("ACTIVE 명단에 없는 소유자면 true", () => expect(leafOf("3d").ownerLeft).toBe(true));
  it("ACTIVE 소유자·팀 과제는 false", () => {
    expect(leafOf("33").ownerLeft).toBe(false);
    expect(leafOf("41").ownerLeft).toBe(false);
  });
});
