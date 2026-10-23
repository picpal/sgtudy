import { clampCp, maxEndDate } from "@/components/room-new/validate";
import { addDays, isYmd, stripControl } from "./normalize";
import { ACCESS_VALUES, STYLE_VALUES, type Ask, type ChipOption, type Draft, type Field, type RequiredField } from "./schema";

/* 선택지 칩(D14·§4.2) — 모델 options 를 검증하고, 없거나 틀리면 필드별 기본 칩으로 바꾼다 */

const MAX_OPTIONS = 6;
const LABEL_MAX = 30;

/** 다음 주 월요일(오늘이 월요일이어도 다음 주) */
export function nextMonday(today: string): string {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=일
  return addDays(today, ((8 - dow) % 7) || 7);
}
export function firstOfNextMonth(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

export const ACCESS_LABEL: Record<(typeof ACCESS_VALUES)[number], string> = {
  "public-direct": "공개 · 바로 참가",
  "public-approval": "공개 · 승인 후 참가",
  private: "비공개 · 초대 링크",
};
export const STYLE_LABEL: Record<(typeof STYLE_VALUES)[number], string> = {
  "weekly-task": "매주 과제 제출",
  proof: "문제 풀이 인증",
  meeting: "정기 모임(온라인)",
  presentation: "발표·리뷰",
  exam: "회차별 시험",
  other: "기타",
};

/** 필드별 기본 칩. 없으면 null(자유 글) */
export function defaultChips(field: Field, today: string): Ask | null {
  switch (field) {
    case "startDate": {
      const a = nextMonday(today), b = firstOfNextMonth(today);
      const opts = [{ label: `다음 주 월요일 (${md(a)})`, value: a }];
      if (b !== a) opts.push({ label: `다음 달 1일 (${md(b)})`, value: b });
      return { field, kind: "single", options: opts, allowOther: "date" };
    }
    case "endDate":
    case "durationWeeks":
      return { field: "durationWeeks", kind: "single", options: [4, 8, 12].map((n) => ({ label: `${n}주`, value: String(n) })), allowOther: "number" };
    case "maxMembers":
      return { field, kind: "single", options: [4, 6, 10].map((n) => ({ label: `${n}명`, value: String(n) })), allowOther: "number" };
    case "isPublic":
    case "joinMode":
    case "access":
      return { field: "access", kind: "single", options: ACCESS_VALUES.map((v) => ({ label: ACCESS_LABEL[v], value: v })) };
    case "style":
      return { field, kind: "multi", options: STYLE_VALUES.map((v) => ({ label: STYLE_LABEL[v], value: v })) };
    case "leaderDoesTasks":
      return { field, kind: "single", options: [{ label: "네, 같이 해요", value: "true" }, { label: "아니요, 운영만", value: "false" }] };
    default:
      return { field, kind: "text" };
  }
}

/** 칩 값이 이 필드에 맞는 모양인가 */
function validValue(field: Field, v: string, draft: Draft, today: string): boolean {
  switch (field) {
    case "startDate":
      return isYmd(v) && v >= today && v <= addDays(today, 365);
    case "endDate":
      return isYmd(v) && (draft.startDate ? v >= draft.startDate && v <= maxEndDate(draft.startDate) : v >= today);
    case "durationWeeks":
      return /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 52;
    case "maxMembers":
      return /^\d{1,3}$/.test(v) && Number(v) >= 2 && Number(v) <= 100;
    case "minMembers":
      return /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= (draft.maxMembers ?? 100);
    case "access":
      return (ACCESS_VALUES as readonly string[]).includes(v);
    case "style":
      return (STYLE_VALUES as readonly string[]).includes(v);
    case "isPublic":
    case "leaderDoesTasks":
      return v === "true" || v === "false";
    case "joinMode":
      return v === "direct" || v === "approval";
    default:
      return v.length > 0;
  }
}

/** 칩 모양이 정해진 필드 — 모델이 kind 를 다르게 내도 이걸 쓴다 */
const FIXED_KIND: Partial<Record<Field, Ask["kind"]>> = { startDate: "single", durationWeeks: "single", maxMembers: "single", access: "single", isPublic: "single", joinMode: "single", style: "multi", leaderDoesTasks: "single" };
const OTHER: Partial<Record<Field, Ask["allowOther"]>> = { startDate: "date", endDate: "date", durationWeeks: "number", maxMembers: "number", minMembers: "number" };

/** 모델 ask → 화면에 그릴 ask. 옵션 ≤6 · 라벨 ≤30cp · 값 검증, 남는 게 없으면 기본 칩 */
export function sanitizeAsk(ask: { field: Field; kind: Ask["kind"]; options?: ChipOption[] | null; allowOther?: Ask["allowOther"] | null } | null, draft: Draft, today: string): Ask | null {
  if (!ask) return null;
  const field = ask.field === "isPublic" || ask.field === "joinMode" ? "access" : ask.field;
  const fallback = defaultChips(field, today);
  const options = (ask.options ?? [])
    .map((o) => ({ label: clampCp(stripControl(o.label).trim(), LABEL_MAX), value: stripControl(o.value).trim() }))
    .filter((o, i, all) => o.label && validValue(field, o.value, draft, today) && all.findIndex((x) => x.value === o.value) === i)
    .slice(0, MAX_OPTIONS);
  if (fallback?.options && (!options.length || field === "access" || field === "style")) return fallback; // 공개/참가·진행 방식은 값 집합이 고정
  const kind = FIXED_KIND[field] ?? (options.length ? (ask.kind === "multi" ? "multi" : "single") : "text");
  const allowOther = OTHER[field] ?? (options.length ? ask.allowOther ?? "text" : undefined);
  return { field, kind, ...(options.length ? { options } : {}), ...(allowOther ? { allowOther } : {}) };
}

/**
 * 필수는 다 찼는데 모델이 칩 없이 확인을 물었을 때("이대로 미리보기로 갈까요?") — 예/아니요 칩.
 * 고르면 글이 모델로 가고, 모델이 done 을 낸다(아니요면 무엇을 바꿀지 묻는다)
 */
export const CONFIRM_ASK: Ask = { field: "extra", kind: "single", options: [{ label: "네, 이대로 갈게요", value: "yes" }, { label: "바꿀 게 있어요", value: "no" }] };

/** 모델이 질문을 안 냈는데 필수가 남았을 때 — 첫 빈 칸의 기본 질문 */
export function defaultAsk(missing: RequiredField[], today: string): Ask | null {
  return missing.length ? defaultChips(missing[0], today) : null;
}
