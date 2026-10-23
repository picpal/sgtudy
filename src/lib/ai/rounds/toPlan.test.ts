import { describe, expect, it } from "vitest";
import { planDoc } from "@/lib/mcp/plan-schema";
import { addDays } from "../normalize";
import { splitRounds } from "./schedule";
import type { RoundsModel } from "./schema";
import { examEachRound, goalWithHead, placeRounds, tasksPerRound, toPlan } from "./toPlan";

/* 계획서 서버 조립(D24·D31·Review Focus 2) — planDoc 통과 · 날짜는 회차 표 · 보정 */
const S = "2026-10-26";
const sched = (weeks: number) => splitRounds(S, addDays(S, weeks * 7 - 1));
const model = (n: number, tasks = 3): RoundsModel => ({
  rounds: Array.from({ length: n }, (_, i) => ({
    title: `범위 ${i + 1}`,
    goalMd: `이번 주 목표: ${i + 1}\n- 불릿`,
    tasks: Array.from({ length: tasks }, (_, k) => ({ title: `과제 ${k + 1}`, descriptionMd: "올려요" })),
  })),
});
type Node = { title: string; descriptionMd?: string; startDate?: string; endDate?: string; kind?: string; taskType?: string; children?: Node[] };
const count = (nodes: Node[]): number => nodes.reduce((n, x) => n + 1 + count(x.children ?? []), 0);

describe("toPlan", () => {
  it("planDoc.parse 통과 · 회차 = create parent null · 날짜·라벨은 회차 표 그대로", () => {
    const s = sched(12);
    const r = toPlan(s, model(12), { tasksPerRound: 2, examEachRound: true });
    expect(() => planDoc.parse(r.plan)).not.toThrow();
    expect(r.plan.ops).toHaveLength(12);
    r.plan.ops.forEach((op, i) => {
      expect(op).toMatchObject({ op: "create", parent: null, label: s.rounds[i].label, startDate: s.rounds[i].startDate, endDate: s.rounds[i].endDate, title: `범위 ${i + 1}` });
    });
    expect(r.plan.ops[0]).toMatchObject({ descriptionMd: "이번 주 목표: 1\n- 불릿" });
  });
  it("children: 과제는 tasksPerRound 개로 자르고 common · 날짜 키 없음 · exam 리프(children 없음)", () => {
    const r = toPlan(sched(4), model(4, 5), { tasksPerRound: 2, examEachRound: true });
    const kids = (r.plan.ops[1] as unknown as Node).children!;
    expect(kids).toEqual([
      { title: "과제 1", descriptionMd: "올려요", taskType: "common" },
      { title: "과제 2", descriptionMd: "올려요", taskType: "common" },
      { title: "2주차 확인 시험", kind: "exam" },
    ]);
    for (const k of kids) expect(Object.keys(k).some((x) => /date|children/i.test(x))).toBe(false);
    expect(r.stats).toEqual({ rounds: 4, tasks: 8, exams: 4, cadenceDays: 7 });
  });
  it("노드 수 = N × (1 + tasks + exam) ≤ 200 — 최대(26회차·과제 2·시험)", () => {
    const s = splitRounds(S, "2027-10-26");
    const r = toPlan(s, model(26), { tasksPerRound: 2, examEachRound: true });
    const n = count(r.plan.ops as unknown as Node[]);
    expect(n).toBe(s.rounds.length * 4);
    expect(n).toBeLessThanOrEqual(200);
    expect(() => planDoc.parse(r.plan)).not.toThrow();
  });
  it("모자라면 'N주차 학습' 으로 채우고 padded · 넘치면 자른다", () => {
    const short = toPlan(sched(5), model(3), { tasksPerRound: 1, examEachRound: false });
    expect(short.padded).toBe(2);
    expect(short.plan.ops.map((o) => (o as unknown as Node).title)).toEqual(["범위 1", "범위 2", "범위 3", "4주차 학습", "5주차 학습"]);
    expect(short.plan.ops[4]).not.toHaveProperty("children");
    expect(short.plan.ops[4]).not.toHaveProperty("descriptionMd");
    expect(() => planDoc.parse(short.plan)).not.toThrow();
    const long = toPlan(sched(2), model(5), { tasksPerRound: 1, examEachRound: false });
    expect([long.plan.ops.length, long.padded, long.rounds.length]).toEqual([2, 0, 2]);
  });
  it("글 정규화: 빈 제목 → 라벨 대체 · 빈 과제 버림 · 링크·헤딩 제거 · 길이 clamp", () => {
    const m: RoundsModel = {
      rounds: [{ title: "  ", goalMd: "# 제목\n[링크](https://x.example)", tasks: [{ title: "", descriptionMd: "x" }, { title: "가".repeat(60), descriptionMd: "나".repeat(200) }] }],
    };
    const r = toPlan(sched(1), m, { tasksPerRound: 2, examEachRound: false });
    const op = r.plan.ops[0] as unknown as Node & { descriptionMd: string };
    expect(op.title).toBe("1주차 학습");
    expect(op.descriptionMd).toBe("이번 주 목표: 제목\n링크");
    expect(op.children).toHaveLength(1);
    expect([...op.children![0].title].length).toBe(40);
    expect([...op.children![0].descriptionMd!].length).toBe(150);
    expect(r.padded).toBe(0);
  });
  it("목표 앞머리는 서버가 회차 길이로 붙인다(D42) — 모델이 붙인 앞머리(섞인 것 포함)는 떼고 다시", () => {
    expect(goalWithHead("IAM 을 익혀요\n- 정책", 7)).toBe("이번 주 목표: IAM 을 익혀요\n- 정책");
    expect(goalWithHead("이번 회차 목표: IAM 을 익혀요", 7)).toBe("이번 주 목표: IAM 을 익혀요");
    expect(goalWithHead("이번 주 목표: IAM 을 익혀요", 14)).toBe("이번 회차 목표: IAM 을 익혀요");
    expect(goalWithHead("목표: IAM", 14)).toBe("이번 회차 목표: IAM");
    expect(goalWithHead("이번 주 목표:\n- 정책", 7)).toBe("- 정책");
    expect(goalWithHead("- 정책만", 7)).toBe("- 정책만");
    expect(goalWithHead("", 7)).toBe("");
  });
  it("placeRounds: 회차 번호로 자리를 맞추고, 번호 없음·틀림·겹침은 남은 자리에 순서대로", () => {
    const s = sched(4);
    const it_ = (index: number | undefined, title: string) => ({ index, title, goalMd: "", tasks: [] });
    const placed = new Map();
    placeRounds(s.rounds, [it_(4, "넷"), it_(undefined, "가"), it_(4, "겹침"), it_(9, "틀림")], placed);
    expect([0, 1, 2, 3].map((i) => placed.get(i)?.title)).toEqual(["가", "겹침", "틀림", "넷"]);
    // 재요청은 빈 자리만 받는다
    const p2 = new Map([[0, it_(1, "하나")]]);
    placeRounds(s.rounds.slice(2), [it_(3, "셋"), it_(1, "엉뚱")], p2);
    expect([0, 1, 2, 3].map((i) => p2.get(i)?.title)).toEqual(["하나", undefined, "셋", "엉뚱"]);
  });
  it("rounds(표시용)는 plan.ops 와 1:1", () => {
    const r = toPlan(sched(3), model(3), { tasksPerRound: 1, examEachRound: true });
    expect(r.rounds[2]).toEqual({ index: 2, label: "3주차", startDate: addDays(S, 14), endDate: addDays(S, 20), title: "범위 3", goalMd: "이번 주 목표: 3\n- 불릿", tasks: ["과제 1"], exam: true });
  });
  it("style → 과제 수·시험", () => {
    expect([tasksPerRound([]), tasksPerRound(["meeting"]), tasksPerRound(["weekly-task"]), tasksPerRound(["proof"])]).toEqual([1, 1, 2, 2]);
    expect([examEachRound(["exam"]), examEachRound(["weekly-task"])]).toEqual([true, false]);
  });
});
