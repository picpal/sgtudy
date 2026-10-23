import { sanitizeLine, sanitizeMd } from "./sanitize";
import type { Schedule } from "./schedule";
import { GOAL_MAX, ROUND_TITLE_MAX, TASK_DESC_MAX, TASK_TITLE_MAX, type RoundsModel, type RoundsResponse, type RoundView } from "./schema";

/*
 * 계획서는 서버가 조립한다(D31) — 모델 출력은 글뿐이고 op·parent·날짜·라벨·kind·taskType 은 여기서 붙인다.
 * 회차 수는 회차 표가 정한다: 모자라면 "N주차 학습" 으로 채우고(padded), 넘치면 자른다. 과제는 전부 common(멤버가 아직 없다)
 */

/** 과제 수(D25) — 매주 과제·인증 방식이면 2, 아니면 1 */
export const tasksPerRound = (style: readonly string[]) => (style.includes("weekly-task") || style.includes("proof") ? 2 : 1);
/** 시험 리프(D26) — "회차별 시험" 을 골랐을 때만 */
export const examEachRound = (style: readonly string[]) => style.includes("exam");

type Child = { title: string; descriptionMd?: string; taskType?: "common"; kind?: "exam" };

export function toPlan(schedule: Schedule, model: RoundsModel, opts: { tasksPerRound: number; examEachRound: boolean }): RoundsResponse {
  let padded = 0;
  const views: RoundView[] = [];
  const ops = schedule.rounds.map((r, i) => {
    const m = model.rounds[i];
    if (!m) padded++;
    const title = (m && sanitizeLine(m.title, ROUND_TITLE_MAX)) || `${r.label} 학습`;
    const goalMd = m ? sanitizeMd(m.goalMd, GOAL_MAX) : "";
    const tasks = (m?.tasks ?? [])
      .map((t) => ({ title: sanitizeLine(t.title, TASK_TITLE_MAX), descriptionMd: sanitizeMd(t.descriptionMd, TASK_DESC_MAX) }))
      .filter((t) => t.title)
      .slice(0, opts.tasksPerRound);
    const children: Child[] = tasks.map((t) => ({ title: t.title, ...(t.descriptionMd ? { descriptionMd: t.descriptionMd } : {}), taskType: "common" }));
    if (opts.examEachRound) children.push({ title: `${r.label} 확인 시험`, kind: "exam" });
    views.push({ index: r.index, label: r.label, startDate: r.startDate, endDate: r.endDate, title, goalMd, tasks: tasks.map((t) => t.title), exam: opts.examEachRound });
    return {
      op: "create" as const, parent: null, label: r.label, title, startDate: r.startDate, endDate: r.endDate,
      ...(goalMd ? { descriptionMd: goalMd } : {}),
      ...(children.length ? { children } : {}),
    };
  });
  return {
    plan: { schema: "sgtudy.plan/v1", ops },
    rounds: views,
    stats: { rounds: views.length, tasks: views.reduce((n, v) => n + v.tasks.length, 0), exams: opts.examEachRound ? views.length : 0, cadenceDays: schedule.cadenceDays },
    padded,
  };
}
