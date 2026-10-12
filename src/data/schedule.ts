import type { TaskStatus } from "@/lib/types";

/** MySchedule.dc.html 목 데이터 — docs/specs/myschedule.md §3·§4 */

export type StudyId = "aws" | "spring" | "sqld";

export type Study = {
  id: StudyId;
  name: string;
  bg: string;
  fg: string;
  dot: string;
  /** 승인 대기 — 막대 줄무늬, RoomView 로 연결 */
  pending?: boolean;
};

export const STUDIES: Study[] = [
  { id: "aws", name: "AWS SAA", bg: "#DDF4EE", fg: "#0B6553", dot: "#12A386" },
  { id: "spring", name: "Spring 로드맵", bg: "#EEE7FB", fg: "#5B3AA0", dot: "#7C5BD0" },
  { id: "sqld", name: "SQLD · 승인 대기", bg: "#FBEFD3", fg: "#7A4F00", dot: "#C98A00", pending: true },
];

export const STUDY = Object.fromEntries(STUDIES.map((s) => [s.id, s])) as Record<StudyId, Study>;

/** 스터디 칩용 짧은 이름 — " · " 앞부분 */
export const shortName = (s: Study) => s.name.split(" · ")[0];

export type Task = {
  id: number;
  study: StudyId;
  title: string;
  /** 시작일 YYYY-MM-DD */
  s: string;
  /** 마감일 YYYY-MM-DD */
  e: string;
  st: TaskStatus;
  round: string;
};

const RAW: [StudyId, string, string, string, TaskStatus, string][] = [
  ["aws", "IAM 정책 이해", "2026-10-01", "2026-10-03", "done", "1주차"],
  ["aws", "VPC 실습", "2026-10-04", "2026-10-07", "done", "1주차"],
  ["aws", "EC2 인스턴스 유형 정리", "2026-10-08", "2026-10-14", "open", "2주차"],
  ["aws", "ALB vs NLB 실습", "2026-10-15", "2026-10-21", "planned", "3주차"],
  ["aws", "Auto Scaling 정책 정리", "2026-10-22", "2026-10-28", "planned", "4주차"],
  ["aws", "RDS·Aurora 비교", "2026-10-29", "2026-11-04", "planned", "5주차"],
  ["spring", "섹션 1~5 정리 노트", "2026-10-05", "2026-10-11", "done", "1주차"],
  ["spring", "스프링 컨테이너 실습", "2026-10-08", "2026-10-11", "late", "1주차"],
  ["spring", "섹션 6~7 정리 노트", "2026-10-12", "2026-10-18", "open", "2주차"],
  ["spring", "싱글톤 컨테이너 실습 코드", "2026-10-15", "2026-10-18", "planned", "2주차"],
  ["spring", "MVC 구조 이해 노트", "2026-10-19", "2026-10-25", "planned", "3주차"],
  ["spring", "서블릿→MVC 리팩토링", "2026-10-22", "2026-10-25", "planned", "3주차"],
  ["spring", "MVC 1편 섹션 5~7 노트", "2026-10-26", "2026-11-01", "planned", "4주차"],
  ["sqld", "데이터 모델링 요약 노트", "2026-10-26", "2026-11-01", "planned", "1주차"],
  ["sqld", "1과목 기출 풀이", "2026-10-29", "2026-11-01", "planned", "1주차"],
];

export const TASKS: Task[] = RAW.map(([study, title, s, e, st, round], id) => ({ id, study, title, s, e, st, round }));

export type Marker = { date: string; study: StudyId; round: string };

export const MARKERS: Marker[] = [
  { date: "2026-10-01", study: "aws", round: "1주차" },
  { date: "2026-10-05", study: "spring", round: "1주차" },
  { date: "2026-10-08", study: "aws", round: "2주차" },
  { date: "2026-10-12", study: "spring", round: "2주차" },
  { date: "2026-10-15", study: "aws", round: "3주차" },
  { date: "2026-10-19", study: "spring", round: "3주차" },
  { date: "2026-10-22", study: "aws", round: "4주차" },
  { date: "2026-10-26", study: "spring", round: "4주차" },
  { date: "2026-10-26", study: "sqld", round: "1주차" },
  { date: "2026-10-29", study: "aws", round: "5주차" },
];
