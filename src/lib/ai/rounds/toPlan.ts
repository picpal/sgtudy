import { sanitizeLine, sanitizeMd } from "./sanitize";
import type { Cadence, Schedule, ScheduleRound } from "./schedule";
import { GOAL_MAX, ROUND_TITLE_MAX, TASK_DESC_MAX, TASK_TITLE_MAX, type RoundModelItem, type RoundsResponse, type RoundView } from "./schema";

/*
 * 계획서는 서버가 조립한다(D31) — 모델 출력은 글뿐이고 op·parent·날짜·라벨·kind·taskType 은 여기서 붙인다.
 * 회차 수는 회차 표가 정한다: 모자라면 "N주차 학습" 으로 채우고(padded), 넘치면 자른다. 과제는 전부 common(멤버가 아직 없다)
 */

/**
 * 모델 출력 → 회차 자리(D39). 회차 번호(index, 1부터)가 맞는 항목을 먼저 그 자리에, 번호가 없거나 틀리거나 겹친 항목은
 * 남은 빈 자리에 순서대로. placed 는 schedule index(0부터) → 항목 — 재요청 결과를 같은 맵에 더한다
 */
export function placeRounds(slots: readonly ScheduleRound[], items: readonly RoundModelItem[], placed: Map<number, RoundModelItem>): void {
  const rest: RoundModelItem[] = [];
  for (const it of items) {
    const slot = it.index === undefined ? undefined : slots.find((r) => r.index + 1 === it.index);
    if (slot && !placed.has(slot.index)) placed.set(slot.index, it);
    else rest.push(it);
  }
  for (const r of slots) if (!placed.has(r.index) && rest.length) placed.set(r.index, rest.shift()!);
}

const GOAL_HEAD = /^(?:이번\s*(?:주|회차)\s*)?목표\s*[:：]\s*/;
/**
 * 목표 앞머리는 서버가 붙인다(D42) — 7일 회차 "이번 주 목표:", 14일 "이번 회차 목표:". 모델이 붙여 보냈으면 떼고 다시 붙인다.
 * 첫 줄이 불릿이면(목표 문장이 없음) 그대로 둔다
 */
export function goalWithHead(raw: string, cadence: Cadence): string {
  const head = `${cadence === 7 ? "이번 주" : "이번 회차"} 목표: `;
  const body = sanitizeMd(raw, GOAL_MAX);
  const [first = "", ...rest] = body.split("\n");
  if (first.startsWith("- ")) return body;
  const sentence = first.replace(GOAL_HEAD, "").trim();
  if (!sentence) return rest.join("\n").trim(); // 앞머리만 있는 줄
  return sanitizeMd([head + sentence, ...rest].join("\n"), GOAL_MAX);
}

/** 과제 수(D25) — 매주 과제·인증 방식이면 2, 아니면 1 */
export const tasksPerRound = (style: readonly string[]) => (style.includes("weekly-task") || style.includes("proof") ? 2 : 1);
/** 시험 리프(D26) — "회차별 시험" 을 골랐을 때만 */
export const examEachRound = (style: readonly string[]) => style.includes("exam");

type Child = { title: string; descriptionMd?: string; taskType?: "common"; kind?: "exam" };

/** model.rounds[i] = 회차 표 i 번째 자리(placeRounds 결과). 빈 자리는 채움 회차 */
export function toPlan(schedule: Schedule, model: { rounds: readonly (RoundModelItem | undefined)[] }, opts: { tasksPerRound: number; examEachRound: boolean }): RoundsResponse {
  let padded = 0;
  const views: RoundView[] = [];
  const ops = schedule.rounds.map((r, i) => {
    const m = model.rounds[i];
    if (!m) padded++;
    const title = (m && sanitizeLine(m.title, ROUND_TITLE_MAX)) || `${r.label} 학습`;
    const goalMd = m ? goalWithHead(m.goalMd, schedule.cadenceDays) : "";
    const tasks = (m?.tasks ?? [])
      .map((t) => ({ title: sanitizeLine(t.title, TASK_TITLE_MAX), descriptionMd: sanitizeMd(t.descriptionMd, TASK_DESC_MAX) }))
      .filter((t) => t.title)
      .slice(0, opts.tasksPerRound);
    const children: Child[] = tasks.map((t) => ({ title: t.title, ...(t.descriptionMd ? { descriptionMd: t.descriptionMd } : {}), taskType: "common" }));
    if (opts.examEachRound) children.push({ title: `${r.label} 확인 시험`, kind: "exam" });
    views.push({ index: r.index, label: r.label, startDate: r.startDate, endDate: r.endDate, title, goalMd, tasks: tasks.map((t) => t.title), exam: opts.examEachRound, ...(m ? {} : { padded: true as const }) });
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
