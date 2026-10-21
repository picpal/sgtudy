import { z } from "zod";

/* MCP prompt 〔UX 재검토 D19〕 — `/mcp__sgtudy__draft-curriculum` 으로 부를 때만 컨텍스트에 들어간다(상주 비용 0).
   본문은 영어 지침 + 한국어 용어 */
export type PromptDef = {
  name: string;
  title: string;
  description: string;
  args: Record<string, z.ZodTypeAny>;
  render: (a: Record<string, string>) => string;
};

const EXAMPLE = JSON.stringify({
  schema: "sgtudy.plan/v1",
  ops: [
    { op: "create", parent: null, label: "1주차", title: "IAM 기초", startDate: "2026-11-02", endDate: "2026-11-08",
      children: [{ title: "IAM 정책 읽기" }, { title: "핵심 정리", children: [{ title: "용어 정리" }, { title: "퀴즈 풀기" }] }] },
    { op: "create", parent: null, label: "2주차", title: "EC2", startDate: "2026-11-09", endDate: "2026-11-15",
      children: [{ title: "인스턴스 실습", taskType: "designated", assignees: ["민수"] }, { title: "요금 비교" }] },
  ],
});

export const PROMPTS: PromptDef[] = [
  {
    name: "draft-curriculum",
    title: "진행목표 초안 만들기",
    description: "Draft a study curriculum (진행목표) week by week, preview it, and apply after approval.",
    args: {
      study: z.string().describe("study slug or name"),
      topic: z.string().describe("what the study covers"),
      weeks: z.string().optional().describe("number of weekly rounds"),
      perWeek: z.string().optional().describe("tasks per round, e.g. 3"),
    },
    render: (a) => [
      `Draft a curriculum (진행목표) for study "${a.study}" on: ${a.topic}.`,
      `1. Call get_curriculum(study:"${a.study}") (outline) to read the study period, members and existing rounds (회차).`,
      `2. Plan ${a.weeks ? `${a.weeks} ` : ""}weekly rounds: label "N주차", 7 days each, continuing after existing rounds. `
        + `Give each round ${a.perWeek ?? "2-5"} tasks (과제); group a large topic into a bundle (묶음) with child tasks.`,
      "3. For a designated task (지정 과제) put member nicknames in assignees; otherwise leave it common (공통).",
      "4. If any date falls outside the study period, tell the user and adjust before previewing.",
      "5. Call preview_curriculum_plan with the plan, show the returned Korean summary to the user verbatim, and wait for explicit approval.",
      "6. Only after approval call apply_curriculum_plan(previewId). If the user wants changes, edit the plan and preview again.",
      `Example plan (2 rounds):\n${EXAMPLE}`,
    ].join("\n"),
  },
];
