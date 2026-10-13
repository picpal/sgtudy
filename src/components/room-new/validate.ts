import type { CreateRoom, JoinMode } from "@/lib/api/types";

export type NewRoomValues = {
  title: string; intro: string; startDate: string; endDate: string; maxMembers: string; isPublic: boolean; joinMode: JoinMode;
  descriptionMd: string; rulesMd: string; minMembers: string; leaderDoesTasks: boolean;
};
export const EMPTY_VALUES: NewRoomValues = { title: "", intro: "", startDate: "", endDate: "", maxMembers: "6", isPublic: true, joinMode: "direct", descriptionMd: "", rulesMd: "", minMembers: "", leaderDoesTasks: true };

const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : NaN);

export function validateNewRoom(v: NewRoomValues, today: string): Partial<Record<keyof NewRoomValues, string>> {
  const e: Partial<Record<keyof NewRoomValues, string>> = {};
  const title = v.title.trim();
  if (!title) e.title = "제목을 입력해 주세요";
  else if (title.length > 60) e.title = "제목은 60자까지예요";
  const intro = v.intro.trim();
  if (!intro) e.intro = "한 줄 소개를 입력해 주세요";
  else if (intro.length > 100) e.intro = "한 줄 소개는 100자까지예요";
  if (!v.startDate) e.startDate = "시작일을 선택해 주세요";
  else if (v.startDate < today) e.startDate = "시작일은 오늘 이후여야 해요";
  if (!v.endDate) e.endDate = "종료일을 선택해 주세요";
  else if (v.startDate && v.endDate < v.startDate) e.endDate = "종료일은 시작일 이후여야 해요";
  const max = int(v.maxMembers);
  if (!(max >= 2 && max <= 100)) e.maxMembers = "최대 인원은 2~100명이에요";
  if (v.minMembers.trim()) {
    const min = int(v.minMembers);
    if (!(min >= 1)) e.minMembers = "최소 인원은 1명 이상이에요";
    else if (max >= 2 && min > max) e.minMembers = "최소 인원은 최대 인원 이하여야 해요";
  }
  return e;
}

export function toCreateRoom(v: NewRoomValues): CreateRoom {
  const out: CreateRoom = { title: v.title.trim(), intro: v.intro.trim(), startDate: v.startDate, endDate: v.endDate, maxMembers: Number(v.maxMembers), isPublic: v.isPublic, joinMode: v.joinMode, leaderDoesTasks: v.leaderDoesTasks };
  if (v.descriptionMd.trim()) out.descriptionMd = v.descriptionMd.trim();
  if (v.rulesMd.trim()) out.rulesMd = v.rulesMd.trim();
  if (v.minMembers.trim()) out.minMembers = Number(v.minMembers);
  return out;
}
