import { monthWeeks } from "@/components/schedule/calc";
import { rpc, type Db } from "@/lib/api/errors";
import type { ScheduleResponse, ScheduleTask } from "@/lib/api/types";
import { diffDays } from "@/lib/date";
import type { Tone } from "@/lib/palette";
import type { Marker, Study, Task } from "@/data/schedule";

export const MAX_WINDOW_DAYS = 62;
export type Window = { from: string; to: string; sel: string };

/** 달 격자(일~토) 를 기본 창으로, sel 이 밖이면 sel 까지 넓힌다. 62일을 넘으면 sel 을 격자 첫날로 리셋한다(schedule §7-8). */
export function scheduleWindow(y: number, m: number, sel: string): Window {
  const weeks = monthWeeks(y, m);
  const from0 = weeks[0][0];
  const to0 = weeks[weeks.length - 1][6];
  const from = sel < from0 ? sel : from0;
  const to = sel > to0 ? sel : to0;
  if (diffDays(from, to) > MAX_WINDOW_DAYS) return { from: from0, to: to0, sel: from0 };
  return { from, to, sel };
}

export const fetchSchedule = (from: string, to: string, client?: Db) => rpc<ScheduleResponse>("me_schedule", { p_from: from, p_to: to }, client);

/** 목업 STUDIES 색을 tone 키로 (aws=mint, spring=lav, sqld=amber) */
export const STUDY_TONE: Record<Tone, { bg: string; fg: string; dot: string }> = {
  mint: { bg: "#DDF4EE", fg: "#0B6553", dot: "#12A386" },
  lav: { bg: "#EEE7FB", fg: "#5B3AA0", dot: "#7C5BD0" },
  amber: { bg: "#FBEFD3", fg: "#7A4F00", dot: "#C98A00" },
  blue: { bg: "#E3ECFD", fg: "#2F5BC2", dot: "#3B6FE0" },
  peach: { bg: "#FDE8E1", fg: "#B4462B", dot: "#C9583A" },
  slate: { bg: "#E9EEF0", fg: "#4A5563", dot: "#7A8594" },
};

export type ScheduleData = { today: string; studies: Study[]; studyMap: Record<string, Study>; tasks: Task[]; markers: Marker[]; upcoming: Task[] };

const toTask = (t: ScheduleTask, today: string): Task => ({
  id: t.id, study: t.slug, title: t.title, s: t.s, e: t.e, round: t.round,
  st: t.st ?? (today < t.s ? "planned" : "open"),
  mine: t.st !== null,
  personal: !!t.personal,
});

export const sortUpcoming = (tasks: Task[]): Task[] => [...tasks].sort((a, b) => a.e.localeCompare(b.e) || a.study.localeCompare(b.study) || a.title.localeCompare(b.title, "ko"));

export function toScheduleData(r: ScheduleResponse): ScheduleData {
  const studies: Study[] = r.studies.map((s) => ({
    id: s.slug,
    name: s.membership === "pending" ? `${s.title} · 승인 대기중` : s.title,
    ...STUDY_TONE[s.tone],
    pending: s.membership === "pending" ? true : undefined,
    membership: s.membership,
  }));
  return {
    today: r.today,
    studies,
    studyMap: Object.fromEntries(studies.map((s) => [s.id, s])),
    tasks: r.tasks.map((t) => toTask(t, r.today)),
    markers: r.markers.map((m) => ({ date: m.date, study: m.slug, round: m.round })),
    upcoming: sortUpcoming(r.upcoming.filter((t) => t.st !== null).map((t) => toTask(t, r.today))),
  };
}
