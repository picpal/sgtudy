import type { CreateRoom, JoinMode } from "@/lib/api/types";

export type NewRoomValues = {
  title: string; intro: string; startDate: string; endDate: string; maxMembers: string; isPublic: boolean; joinMode: JoinMode;
  descriptionMd: string; rulesMd: string; minMembers: string; leaderDoesTasks: boolean;
};
export const EMPTY_VALUES: NewRoomValues = { title: "", intro: "", startDate: "", endDate: "", maxMembers: "6", isPublic: true, joinMode: "direct", descriptionMd: "", rulesMd: "", minMembers: "", leaderDoesTasks: true };

const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : NaN);
/** 서버 length() 와 같은 코드 포인트 길이 (이모지 1자 = 1) */
export const cpLength = (s: string) => [...s].length;

/** 입력을 N 코드 포인트에서 자른다 — input maxLength 는 UTF-16 단위라 이모지가 2칸으로 세여 서버 한도와 어긋난다 */
export const clampCp = (s: string, n: number) => (cpLength(s) > n ? [...s].slice(0, n).join("") : s);

/** 인라인 오류를 그리는 입력 — 서버 details.field 가 이 중 하나면 그 칸 아래에 보여 준다 */
const FIELD_KEYS = ["title", "intro", "startDate", "endDate", "maxMembers", "minMembers"] as const;

/** 폼 순서상 첫 오류 칸 — 제출 시 그 칸으로 포커스를 옮긴다 */
export function firstErrorKey(errs: Partial<Record<keyof NewRoomValues, string>>): (typeof FIELD_KEYS)[number] | null {
  return FIELD_KEYS.find((k) => errs[k]) ?? null;
}

/** room_create 오류 → 필드 오류. 그릴 칸이 없는 field(또는 field 없음)면 null → 폼 하단 문구로 */
export function serverFieldError(details: Record<string, string> | undefined, message: string): Partial<Record<keyof NewRoomValues, string>> | null {
  const f = details?.field;
  return f && (FIELD_KEYS as readonly string[]).includes(f) ? { [f]: message } : null;
}

/** 서버 PERIOD_TOO_LONG 과 같은 상한 — 시작일 + 1년 - 1일 (Postgres interval: 2/29 + 1년 = 2/28). YYYY-MM-DD, 시작일 없으면 "" */
export function maxEndDate(start: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]) + 1, Number(m[2]), Number(m[3])];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const t = new Date(Date.UTC(y, mo - 1, Math.min(d, last) - 1));
  return t.toISOString().slice(0, 10);
}
export const PERIOD_TOO_LONG = "기간은 최대 1년이에요";

export function validateNewRoom(v: NewRoomValues, today: string): Partial<Record<keyof NewRoomValues, string>> {
  const e: Partial<Record<keyof NewRoomValues, string>> = {};
  const title = v.title.trim();
  if (!title) e.title = "제목을 입력해 주세요";
  else if (cpLength(title) > 60) e.title = "제목은 60자까지예요";
  const intro = v.intro.trim();
  if (!intro) e.intro = "한 줄 소개를 입력해 주세요";
  else if (cpLength(intro) > 100) e.intro = "한 줄 소개는 100자까지예요";
  if (!v.startDate) e.startDate = "시작일을 선택해 주세요";
  else if (v.startDate < today) e.startDate = "시작일은 오늘 이후여야 해요";
  if (!v.endDate) e.endDate = "종료일을 선택해 주세요";
  else if (v.startDate && v.endDate < v.startDate) e.endDate = "종료일은 시작일 이후여야 해요";
  else if (v.startDate && v.endDate > maxEndDate(v.startDate)) e.endDate = PERIOD_TOO_LONG;
  const max = int(v.maxMembers);
  if (!(max >= 2 && max <= 100)) e.maxMembers = "최대 인원은 2~100명이에요";
  if (v.minMembers.trim()) {
    const min = int(v.minMembers);
    if (!(min >= 1)) e.minMembers = "최소 인원은 1명 이상이에요";
    else if (max >= 2 && min > max) e.minMembers = "최소 인원은 최대 인원 이하여야 해요";
  }
  return e;
}

type Errors = Partial<Record<keyof NewRoomValues, string>>;
/** 한 칸을 바꾸면 같이 다시 봐야 하는 칸 (기간·인원은 서로 묶여 있다) */
const RELATED: Partial<Record<keyof NewRoomValues, (keyof NewRoomValues)[]>> = {
  startDate: ["startDate", "endDate"],
  endDate: ["startDate", "endDate"],
  maxMembers: ["maxMembers", "minMembers"],
  minMembers: ["maxMembers", "minMembers"],
};

/**
 * 입력 중 오류 갱신 (V1-01) — 이미 떠 있는 오류만 다시 계산한다. 바뀐 칸(과 묶인 칸)이 유효해지면 지우고,
 * 아직 틀리면 지금 값에 맞는 문구로 바꾼다. 새 오류는 만들지 않는다(그건 제출 때).
 */
export function revalidateOnChange(errors: Errors, changed: keyof NewRoomValues, next: NewRoomValues, today: string): Errors {
  const keys = (RELATED[changed] ?? [changed]).filter((k) => errors[k]);
  if (!keys.length) return errors;
  const fresh = validateNewRoom(next, today);
  const out = { ...errors };
  for (const k of keys) {
    if (fresh[k]) out[k] = fresh[k];
    else delete out[k];
  }
  return out;
}

export function toCreateRoom(v: NewRoomValues): CreateRoom {
  const out: CreateRoom = { title: v.title.trim(), intro: v.intro.trim(), startDate: v.startDate, endDate: v.endDate, maxMembers: Number(v.maxMembers), isPublic: v.isPublic, joinMode: v.joinMode, leaderDoesTasks: v.leaderDoesTasks };
  if (v.descriptionMd.trim()) out.descriptionMd = v.descriptionMd.trim();
  if (v.rulesMd.trim()) out.rulesMd = v.rulesMd.trim();
  if (v.minMembers.trim()) out.minMembers = Number(v.minMembers);
  return out;
}
