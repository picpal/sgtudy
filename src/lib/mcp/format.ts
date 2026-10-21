/* MCP 도구 응답 텍스트 〔UX 재검토 §4 · D12〕 — 텍스트 1벌, 한국어 요약 먼저, id 는 줄 맨 앞, uuid 없음, 8,000자 상한.
   입력은 api_invoke 의 data(계약: src/lib/mcp/__fixtures__/api-contract.json · contract.test.ts) */
import type { RoomStatusDto, ScheduleResponse } from "@/lib/api/types";
import type { TaskStatus } from "@/lib/types";
import { errorLine, nextStep, toolErrorText } from "./errors";
import { toCurriculumTree, type CurriculumTree, type GatewayCurriculum, type TreeNode } from "./tree";

export const MAX_TEXT = 8000;
export const MAX_DIFF_LINES = 40;

/* ---------- 날짜 ---------- */
type Period = { startDate: string; endDate: string };
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => fromUtc(toUtc(d) + n * 86_400_000);
const dowOf = (d: string) => DOW[new Date(toUtc(d)).getUTCDay()];
const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
/** ISO 시각 → KST 'YYYY-MM-DD HH:mm' */
const kst = (iso: string) => new Date(Date.parse(iso) + 9 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");

/** 스터디 기간이 한 해 안이면 MM-DD, 해를 넘으면(또는 기간과 다른 해면) YYYY-MM-DD */
export function dateFmt(d: string, period: Period): string {
  const y = period.startDate.slice(0, 4);
  return y === period.endDate.slice(0, 4) && d.slice(0, 4) === y ? d.slice(5) : d;
}

export type Range = "today" | "this_week" | "next_week" | { from: string; to: string };
/** KST 달력 주(월~일). fetchFrom = 놓친 것(최근 14일)까지 함께 읽을 시작일 */
export function weekWindow(today: string, range: Range): { from: string; to: string; fetchFrom: string } {
  const monday = addDays(today, -((new Date(toUtc(today)).getUTCDay() + 6) % 7));
  const w = range === "today" ? { from: today, to: today }
    : range === "this_week" ? { from: monday, to: addDays(monday, 6) }
    : range === "next_week" ? { from: addDays(monday, 7), to: addDays(monday, 13) }
    : { from: range.from, to: range.to };
  const back = addDays(today, -14);
  return { ...w, fetchFrom: back < w.from ? back : w.from };
}

/* ---------- 절단 ---------- */
/** 마지막 완전한 줄까지 자르고 안내 1줄. footer(n) = 남은 줄 수를 받아 안내 문구 */
function capLines(lines: string[], footer: (rest: number, firstCut: number) => string): string {
  const full = lines.join("\n");
  if (full.length <= MAX_TEXT) return full;
  let len = 0;
  let k = 0;
  for (; k < lines.length; k++) {
    const next = len + lines[k].length + 1;
    if (next + footer(lines.length - k - 1, k + 1).length > MAX_TEXT) break;
    len = next;
  }
  if (lines.length === 1) return `${lines[0].slice(0, MAX_TEXT - 1)}…`;
  if (k === 0) {                                    // 첫 줄부터 상한을 넘으면 그 줄을 잘라서라도 남긴다
    const tail = footer(lines.length - 1, 1);
    return `${lines[0].slice(0, Math.max(MAX_TEXT - tail.length - 2, 0))}…\n${tail}`;
  }
  return [...lines.slice(0, k), footer(lines.length - k, k)].join("\n");
}

/* ---------- 진행목표 ---------- */
const STATUS_TEXT: Record<RoomStatusDto, string> = { draft: "준비 중", recruit: "모집 중", active: "진행 중", ended: "종료" };
export type CurriculumOpts = {
  detail: "outline" | "full";
  /** 서수(1부터, 보관 제외) · "current" · 숫자 문자열 = id · "a-b" 서수 범위 · 그 밖 = 라벨 정확 일치. full 기본 current, outline 기본 전체 */
  rounds?: number | string;
  personal?: "mine" | "none" | "all";
  includeDescriptions?: boolean;
  includeArchived?: boolean;
};

type Picked = { rounds: TreeNode[]; note?: string } | { error: string };
const MAX_CANDIDATES = 20;
/** 회차 선택자 해석 — 서버 plan_round_pick(0034)과 같은 규칙:
    대상 = 보관 안 된 회차(입력 순서 = sort_order·id). 수 = 서수(1부터, 정수만) · 문자열은 trim 후
    "current"(대소문자 무시) = 현재 회차, 없으면 첫 회차 · 숫자 1~18자리 = id(앞 0 무시), 없으면 라벨로 · 그 밖 = 라벨(trim) 정확 일치.
    라벨이 겹치면 ROUND_AMBIGUOUS(후보 "n번째 · 라벨 · 제목" ≤ 20), 못 찾으면 ROUND_NOT_FOUND(후보 라벨|제목 ≤ 20).
    포맷터 전용 확장: 라벨에도 id 에도 안 맞는 "a-b" = 서수 범위 */
function pickRounds(all: TreeNode[], sel: number | string | undefined): Picked {
  if (sel === undefined) return { rounds: all };
  const live = all.filter((r) => !r.archived);
  const notFound = (): Picked => ({ error: toolErrorText({ code: "ROUND_NOT_FOUND", message: "회차를 찾을 수 없어요",
    details: { candidates: live.slice(0, MAX_CANDIDATES).map((r) => r.label ?? r.title) } }) });
  if (typeof sel === "number") return Number.isInteger(sel) && sel >= 1 && live[sel - 1] ? { rounds: [live[sel - 1]] } : notFound();
  const s = sel.trim();
  if (s.toLowerCase() === "current") {
    const cur = live.find((r) => r.current);
    if (cur) return { rounds: [cur] };
    return live.length ? { rounds: [live[0]], note: "(현재 회차가 없어 첫 회차를 보여요)" } : notFound();
  }
  if (/^[0-9]{1,18}$/.test(s)) {
    const id = BigInt(s).toString();
    const byId = live.find((r) => r.id === id);
    if (byId) return { rounds: [byId] };
  }
  if (s === "") return notFound();
  const byLabel = live.filter((r) => (r.label ?? "").trim() === s);
  if (byLabel.length === 1) return { rounds: byLabel };
  if (byLabel.length > 1) {
    const ord = (r: TreeNode) => live.indexOf(r) + 1;
    return { error: toolErrorText({ code: "ROUND_AMBIGUOUS", message: "같은 라벨의 회차가 여러 개예요. 몇 번째 회차인지(숫자)나 id 로 골라 주세요",
      details: { candidates: byLabel.slice(0, MAX_CANDIDATES).map((r) => `${ord(r)}번째 · ${r.label ?? ""} · ${r.title}`) } }) };
  }
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(s);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])];
    const out = live.slice(Math.max(a, 1) - 1, b);
    if (out.length && a <= b) return { rounds: out };
  }
  return notFound();
}

const typeTag = (n: TreeNode) =>
  n.kind === "bundle" ? "[묶음]"
  : n.taskType === "designated" ? `[지정: ${n.assigneeNicknames?.length ? n.assigneeNicknames.join(", ") : "미정"}]`
  : n.taskType === "common" ? "[공통]" : "";

/** 부모와 같은 기간 → 생략 · 시작만 같으면 마감만 `~MM-DD` · 하루면 `MM-DD` · 그 밖 `MM-DD~MM-DD` */
function periodPart(n: Period, parent: Period | null, study: Period): string {
  const f = (d: string) => dateFmt(d, study);
  if (parent && n.startDate === parent.startDate && n.endDate === parent.endDate) return "";
  if (n.startDate === n.endDate) return f(n.startDate);
  if (parent && n.startDate === parent.startDate) return `~${f(n.endDate)}`;
  return `${f(n.startDate)}~${f(n.endDate)}`;
}
const join = (...parts: (string | false | undefined | null)[]) => parts.filter(Boolean).join(" ");
/** 회차·과제만(묶음은 하위 과제 줄에 이미 있다) */
const progressPart = (n: TreeNode) => (n.kind !== "bundle" && n.progress && n.progress.assigned > 0 ?` · ${n.progress.submitted}/${n.progress.assigned}` : "");
const filesPart = (n: TreeNode) => (n.files > 0 ? ` · 첨부 ${n.files}` : "");
const archivedTag = (n: TreeNode) => (n.archived ? "[보관]" : "");

function countTasks(n: TreeNode): number {
  return n.children.reduce((s, c) => s + (c.kind === "task" ? 1 : 0) + countTasks(c), 0);
}
function personalOf(n: TreeNode, acc: TreeNode[] = []): TreeNode[] {
  for (const c of n.children) {
    if (c.kind === "personal") acc.push(c);
    else personalOf(c, acc);
  }
  return acc;
}

function roundLine(t: CurriculumTree, r: TreeNode, personal: "mine" | "none" | "all"): string {
  const tasks = countTasks(r);
  const goals = personalOf(r);
  const mine = goals.filter((g) => g.isMine === true).length;
  const extra = personal === "mine" && mine > 0 ? ` · 내 목표 ${mine}` : personal === "all" && goals.length > 0 ? ` · 개인 목표 ${goals.length}` : "";
  return join(r.id, archivedTag(r), r.label, typeTag(r), r.title, periodPart(r, null, t.study))
    + (tasks > 0 ? ` · 과제 ${tasks}` : "") + progressPart(r) + filesPart(r) + extra + (r.current ? " ← 현재" : "");
}

function descLines(n: TreeNode, indent: string): string[] {
  return n.descriptionMd ? n.descriptionMd.split("\n").map((l) => `${indent}> ${l}`) : [];
}

function goalItem(g: TreeNode, round: TreeNode, study: Period): string {
  return join(g.id, archivedTag(g), g.title, periodPart(g, round, study), g.done && "✓");
}

function personalLines(t: CurriculumTree, r: TreeNode, personal: "mine" | "none" | "all", indent: string): string[] {
  if (personal === "none") return [];
  const goals = personalOf(r);
  const mine = goals.filter((g) => g.isMine === true);
  const out: string[] = [];
  const room = t.me.canAddPersonal ? `   (남은 자리 ${Math.max(t.me.personalPerRound - mine.filter((g) => !g.archived).length, 0)})` : "";
  if (mine.length) out.push(`${indent}[내 목표] ${mine.map((g) => goalItem(g, r, t.study)).join(" · ")}${room}`);
  else if (room) out.push(`${indent}[내 목표] 없음${room}`);
  if (personal === "all") {
    const others = new Map<string, TreeNode[]>();
    for (const g of goals) {
      if (g.isMine === true) continue;
      const who = g.ownerNickname ? `${g.ownerNickname}의 목표` : "개인 목표";
      others.set(who, [...(others.get(who) ?? []), g]);
    }
    for (const [who, gs] of others) out.push(`${indent}[${who}] ${gs.map((g) => goalItem(g, r, t.study)).join(" · ")}`);
  }
  return out;
}

function nodeLines(t: CurriculumTree, n: TreeNode, parent: TreeNode, depth: number, out: string[]) {
  const indent = "  ".repeat(depth);
  out.push(indent + join(n.id, archivedTag(n), typeTag(n), n.title, periodPart(n, parent, t.study)) + progressPart(n) + filesPart(n));
  out.push(...descLines(n, indent + "  "));
  for (const c of n.children) if (c.kind !== "personal") nodeLines(t, c, n, depth + 1, out);
}

/** curriculum_get → 줄 형식(스펙 §7.1). 개요 = 회차 1줄씩, 상세 = 고른 회차의 하위 트리 */
export function formatCurriculum(c: GatewayCurriculum, opts: CurriculumOpts): { text: string; isError: boolean } {
  const text = curriculumText(c, opts);
  return typeof text === "string" ? { text, isError: false } : { text: text.error, isError: true };
}

function curriculumText(c: GatewayCurriculum, opts: CurriculumOpts): string | { error: string } {
  const t = toCurriculumTree(c, { includeDescriptions: opts.includeDescriptions ?? false, includeArchived: opts.includeArchived });
  const personal = opts.personal ?? "mine";
  const sel = opts.rounds ?? (opts.detail === "full" ? "current" : undefined);
  const s = t.study;
  const head = [
    `${s.slug} | ${s.title} | ${STATUS_TEXT[s.status] ?? s.status} | ${s.startDate}~${s.endDate} | 오늘 ${t.today}(${dowOf(t.today)}) | v ${t.version.slice(0, 8)}`,
    `나: ${t.me.canEditCurriculum ? "편집 가능" : "보기만"} · ${t.me.canAddPersonal ? `개인 목표 회차당 ${t.me.personalPerRound}` : "개인 목표 추가 불가"} | 멤버: `
      + t.members.filter((m) => m.status === "active").map((m) => m.nickname + (m.role === "leader" ? "(그룹장)" : m.canEditCurriculum ? "(편집)" : "")).join(" "),
  ];
  if (t.rounds.length === 0) return [...head, "회차 0 — 진행목표가 비어 있어요"].join("\n");
  const picked = pickRounds(t.rounds, sel);
  if ("error" in picked) return picked;

  const body: { line: string; ord: number }[] = [];
  const ordOf = new Map(t.rounds.filter((r) => !r.archived).map((r, i) => [r.id, i + 1]));
  if (opts.detail === "outline") {
    head.push(`회차 ${t.rounds.filter((r) => !r.archived).length} — id 라벨 제목 기간 · 과제 수 · 제출/배정`);
    for (const r of picked.rounds) body.push({ line: roundLine(t, r, personal), ord: ordOf.get(r.id) ?? 0 });
  } else {
    if (picked.note) head.push(picked.note);
    for (const r of picked.rounds) {
      const lines = [roundLine(t, r, personal), ...descLines(r, "  ")];
      for (const ch of r.children) if (ch.kind !== "personal") nodeLines(t, ch, r, 1, lines);
      lines.push(...personalLines(t, r, personal, "  "));
      for (const line of lines) body.push({ line, ord: ordOf.get(r.id) ?? 0 });
    }
  }
  const lines = [...head, ...body.map((b) => b.line)];
  const lastOrd = ordOf.size;
  return capLines(lines, (rest, cutAt) => {
    const from = body[Math.max(cutAt - head.length, 0)]?.ord || 1;
    return `… 외 ${rest}줄 — rounds:"${from}-${Math.min(from + 3, lastOrd)}" 로 나눠 보세요`;
  });
}

/* ---------- 내 스터디 ---------- */
export type WhoamiData = { userId?: string; nickname: string; source: "pat" | "session" | "oauth"; tokenName: string | null; scopes: string[]; expiresAt: string | null };
export type StudiesData = {
  today: string;
  items: {
    slug: string; title: string; status: RoomStatusDto; role: "leader" | "editor" | "member" | "pending"; canEditCurriculum: boolean;
    canAddPersonal?: boolean; startDate: string; endDate: string;
    currentRound: { id: string; label: string | null; title: string; startDate: string; endDate: string } | null;
  }[];
};
const ROLE_TEXT: Record<StudiesData["items"][number]["role"], string> = { leader: "그룹장", editor: "편집자", member: "멤버", pending: "승인 대기" };

/** `나:` 줄 + 스터디 1줄씩 `slug | 제목 | 역할·편집 | 기간 | 현재 회차` */
export function formatStudies(s: StudiesData, me: WhoamiData): string {
  const who = me.source === "session" || !me.tokenName ? "웹 세션" : `토큰 "${me.tokenName}"`;
  const lines = [join(`나: ${me.nickname} · ${who} · 권한 ${me.scopes.join(", ")}`, me.expiresAt ? `· 만료 ${kst(me.expiresAt).slice(0, 10)}` : "")];
  if (s.items.length === 0) lines.push("참가 중인 스터디가 없어요");
  for (const i of s.items) {
    const role = ROLE_TEXT[i.role] + (i.canEditCurriculum && i.role !== "editor" ? "·편집" : "") + (i.status !== "active" ? ` · ${STATUS_TEXT[i.status]}` : "");
    const cur = i.currentRound ? `현재 ${join(i.currentRound.label, i.currentRound.title)}` : "현재 회차 없음";
    lines.push(`${i.slug} | ${i.title} | ${role} | ${dateFmt(i.startDate, i)}~${dateFmt(i.endDate, i)} | ${cur}`);
  }
  return capLines(lines, (rest) => `… 외 ${rest}줄`);
}

/** 토큰 만료 7일 이내면 안내 1줄, 아니면 null */
export function expiryNotice(expiresAt: string | null, today: string): string | null {
  if (!expiresAt) return null;
  const days = daysBetween(today, kst(expiresAt).slice(0, 10));
  if (days < 0 || days > 7) return null;
  return `토큰이 ${days === 0 ? "오늘" : `${days}일 뒤`} 만료돼요 — /me 「AI 연결」에서 새 토큰을 만들어 주세요`;
}

/* ---------- 내 할 일 ---------- */
const TASK_STATUS_TEXT: Record<TaskStatus, string> = { planned: "예정", open: "진행 중", done: "제출", late: "늦게 제출", missed: "미제출" };
type Window = { from: string; to: string; fetchFrom: string };

function windowLabel(today: string, w: Window): string {
  if (w.from === today && w.to === today) return "오늘";
  const tw = weekWindow(today, "this_week");
  if (w.from === tw.from && w.to === tw.to) return "이번 주";
  const nw = weekWindow(today, "next_week");
  if (w.from === nw.from && w.to === nw.to) return "다음 주";
  return "기간";
}

/** me_schedule → 기간 안(스터디·회차별 묶음) + 놓친 것(최근 14일, 미제출) */
export function formatTasks(s: ScheduleResponse, w: Window, opts: { study?: string } = {}): string {
  const year: Period = { startDate: s.today, endDate: s.today };
  const d = (x: string) => `${dateFmt(x, year)}(${dowOf(x)})`;
  const tag = (t: ScheduleResponse["tasks"][number]) => (t.personal ? "[내 목표]" : "[팀 과제]");
  const st = (t: ScheduleResponse["tasks"][number]) => (t.st ? TASK_STATUS_TEXT[t.st] : "배정 없음");
  const tasks = s.tasks.filter((t) => !opts.study || t.slug === opts.study)
    .toSorted((a, b) => a.e.localeCompare(b.e) || a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id, "en", { numeric: true }));

  const lines = [`${windowLabel(s.today, w)} ${d(w.from)}~${d(w.to)} · 오늘 ${d(s.today)}`];
  const inWin = tasks.filter((t) => t.s <= w.to && t.e >= w.from);
  const groups = new Map<string, typeof inWin>();
  for (const t of inWin) {
    const k = `${t.slug} · ${t.round}`;
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  const keys = [...groups.keys()].toSorted((a, b) => a.localeCompare(b));
  if (keys.length === 0) lines.push("  할 일 없음");
  for (const k of keys) {
    lines.push(k);
    for (const t of groups.get(k)!) lines.push(`  ${t.id} ${tag(t)} ${t.title} ~${d(t.e)} ${st(t)}`);
  }
  if (w.fetchFrom < w.from) {
    const missed = tasks.filter((t) => t.e < w.from && t.e >= w.fetchFrom && t.st === "missed");
    lines.push("놓친 것(최근 14일)");
    if (missed.length === 0) lines.push("  없음");
    for (const t of missed) lines.push(`  ${t.slug} ${t.round} ${t.id} ${tag(t)} ${t.title} ~${d(t.e)} ${st(t)}`);
  }
  return capLines(lines, (rest) => `… 외 ${rest}줄 — range 를 좁히거나 study 를 지정해 보세요`);
}

/* ---------- 미리보기 · 적용 ---------- */
type Pair<T> = [T, T];
export type DiffItem = {
  op: "create" | "update" | "move" | "restore";
  path: string;
  id: string | null;
  kind: "round" | "bundle" | "task" | "personal";
  title: string;
  rpath?: string;
  // create
  ref?: string | null; label?: string | null; taskType?: "common" | "designated" | null; startDate?: string; endDate?: string;
  parent?: string | null; parentPath?: string | null; assignees?: string[];
  // update · restore
  changes?: { title?: Pair<string>; label?: Pair<string | null>; startDate?: Pair<string>; endDate?: Pair<string>; taskType?: Pair<string | null>;
    descriptionMd?: true; assignees?: Pair<string[]> };
  // move
  index?: number; from?: { parentId: string | null; index: number };
};
export type Warning = { code: string; message?: string; nodeId?: string; path?: string };
export type Notifications = { recipients: number; perRecipient: { nickname: string; count: number; collapsed: boolean; newTasks: number }[] } | null;
export type PlanSummary = { created: number; updated: number; moved: number; restored: number; shiftedDescendants: number };
export type Undoable = { ops: number; notUndoable: { created: number; moved: number; otherChanges: number } };
export type PreviewData = {
  ok: boolean; diff: DiffItem[]; warnings: Warning[]; errors: unknown[]; notifications: Notifications;
  previewId?: string; expiresAt?: string; version?: string; undoOf?: string | null; summary?: PlanSummary; undoable?: Undoable;
};
export type ApplyData = {
  ok?: boolean; applied: boolean; previewId: string; createdIds: string[]; refs: Record<string, string>; link: string;
  summary: PlanSummary; notifications: Notifications; undoable?: Undoable; replayed?: boolean; version?: string;
};

/** plan_warn_text(0034) 와 같은 3개 — 서버가 message 를 붙이지만 계약이 깨져도 undefined 를 찍지 않는다 〔C#9〕 */
export const WARN_TEXT: Record<string, string> = {
  PERIOD_OUTSIDE_ROOM: "스터디 기간 밖이에요",
  PERIOD_OUTSIDE_PARENT: "상위 항목 기간 밖이에요",
  UNASSIGNED_TASK: "담당자가 없는 지정 과제예요",
};
const warnText = (w: Warning) => w.message ?? WARN_TEXT[w.code] ?? w.code;
const KIND_TEXT: Record<DiffItem["kind"], string> = { round: "[회차]", bundle: "[묶음]", task: "[과제]", personal: "[개인 목표]" };
const TYPE_TEXT: Record<string, string> = { common: "공통", designated: "지정" };

function summaryText(s: PlanSummary | undefined): string {
  if (!s) return "";
  const parts = [
    s.created && `생성 ${s.created}`,
    s.updated && `변경 ${s.updated}${s.shiftedDescendants ? `(하위 ${s.shiftedDescendants}건 함께 이동)` : ""}`,
    s.moved && `이동 ${s.moved}`,
    s.restored && `날짜 복원 ${s.restored}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function notificationText(n: Notifications): string {
  if (!n || n.recipients === 0 || n.perRecipient.length === 0) return "알림 없음";
  const MAX = 10;
  const each = n.perRecipient.slice(0, MAX).map((p) => {
    const notes = [p.collapsed && "묶음", p.newTasks > 0 && `새 과제 ${p.newTasks}`].filter(Boolean).join(", ");
    return `${p.nickname} ${p.collapsed ? 1 : p.count}건${notes ? `(${notes})` : ""}`;
  });
  const more = n.perRecipient.length > MAX ? ` · 외 ${n.perRecipient.length - MAX}명` : "";
  return `알림: ${each.join(" · ")}${more}`;
}

function undoableText(u: Undoable | undefined): string | null {
  if (!u) return null;
  const web = [u.notUndoable.created && `생성 ${u.notUndoable.created}`, u.notUndoable.moved && `이동 ${u.notUndoable.moved}`,
    u.notUndoable.otherChanges && `일정 외 변경 ${u.notUndoable.otherChanges}`].filter(Boolean).join(" · ");
  if (u.ops > 0) return `되돌리기 가능: 일정 ${u.ops}건(하위·개인 목표 포함)${web ? ` · 웹에서만: ${web}` : ""}`;
  return web ? `되돌리기 불가 · 웹에서만: ${web}` : null;
}

export type PreviewOpts = { slug: string; /** 기존 노드 id → 표시 이름(있으면 상위를 이름으로) */ titles?: Record<string, string>; period?: Period };

/** 미리보기 diff 의 날짜 범위로 연도 생략 여부를 고른다(기간을 모를 때) */
function periodFromDiff(diff: DiffItem[]): Period {
  const ds: string[] = [];
  for (const d of diff) {
    if (d.startDate) ds.push(d.startDate);
    if (d.endDate) ds.push(d.endDate);
    for (const v of [d.changes?.startDate, d.changes?.endDate]) if (v) ds.push(...v);
  }
  ds.sort();
  return ds.length ? { startDate: ds[0], endDate: ds[ds.length - 1] } : { startDate: "0000-01-01", endDate: "9999-12-31" };
}

function changeText(ch: NonNullable<DiffItem["changes"]>, f: (d: string) => string): string {
  const parts: string[] = [];
  if (ch.title) parts.push(`제목 ${ch.title[0]} → ${ch.title[1]}`);
  if (ch.label) parts.push(`라벨 ${ch.label[0] ?? "없음"} → ${ch.label[1] ?? "없음"}`);
  if (ch.startDate || ch.endDate) {
    const side = (i: 0 | 1) => (ch.startDate ? f(ch.startDate[i]) : "") + "~" + (ch.endDate ? f(ch.endDate[i]) : "");
    parts.push(`기간 ${side(0)} → ${side(1)}`);
  }
  if (ch.taskType) parts.push(`유형 ${TYPE_TEXT[ch.taskType[0] ?? ""] ?? "묶음"} → ${TYPE_TEXT[ch.taskType[1] ?? ""] ?? "묶음"}`);
  if (ch.assignees) parts.push(`담당 ${ch.assignees[0].join(", ") || "없음"} → ${ch.assignees[1].join(", ") || "없음"}`);
  if (ch.descriptionMd) parts.push("설명 변경");
  return parts.join(" · ");
}

function diffLine(d: DiffItem, depthOf: Map<string, number>, opts: PreviewOpts, f: (x: string) => string): string {
  const where = (id: string | null | undefined) => (id ? opts.titles?.[id] ?? `#${id}` : "회차 목록");
  if (d.op === "create") {
    const depth = d.parentPath ? (depthOf.get(d.parentPath) ?? 0) + 1 : 0;
    depthOf.set(d.path, depth);
    const tag = d.kind === "round" ? "[회차]" : d.kind === "bundle" ? "[묶음]"
      : d.taskType === "designated" ? `[지정: ${d.assignees?.length ? d.assignees.join(", ") : "미정"}]` : "[공통]";
    const dates = d.startDate && d.endDate ? (d.startDate === d.endDate ? f(d.startDate) : `${f(d.startDate)}~${f(d.endDate)}`) : "";
    const parent = !d.parentPath && d.parent ? `(상위: ${where(d.parent)})` : "";
    return "  ".repeat(depth) + "+ " + join(tag, d.kind === "round" ? d.label : null, d.title, dates, parent);
  }
  if (d.op === "update") return `~ ${KIND_TEXT[d.kind]} ${d.title}: ${changeText(d.changes ?? {}, f)}`;
  if (d.op === "restore") {
    const ch = d.changes ?? {};
    const side = (i: 0 | 1) => (ch.startDate ? f(ch.startDate[i]) : "") + "~" + (ch.endDate ? f(ch.endDate[i]) : "");
    return `↩ 날짜 복원 ${d.title} ${side(0)} → ${side(1)}`;
  }
  const same = d.from && d.from.parentId === d.parent;
  return same
    ? `↪ ${KIND_TEXT[d.kind]} ${d.title} 순서 ${(d.from?.index ?? 0) + 1}번째 → ${(d.index ?? 0) + 1}번째`
    : `↪ ${KIND_TEXT[d.kind]} ${d.title} → 상위: ${where(d.parent)}, ${(d.index ?? 0) + 1}번째`;
}

/** 미리보기 → 한국어 요약(diff 최대 40줄 + 외 N건) · 경고 · 알림 · 되돌리기 · previewId · 다음 행동 */
export function formatPreview(p: PreviewData, opts: PreviewOpts): string {
  if (!p.ok) {
    const errs = p.errors ?? [];
    const lines = [`미리보기 실패 · ${opts.slug} — 오류 ${errs.length}건(아무것도 바뀌지 않았어요)`];
    for (const e of errs.slice(0, 20)) lines.push(`- ${errorLine(e)}`);
    if (errs.length > 20) lines.push(`- … 외 ${errs.length - 20}건`);
    const first = errs[0] as { code?: unknown; candidates?: unknown } | undefined;
    const code = typeof first?.code === "string" ? first.code : "PLAN_INVALID";
    lines.push(`→ 다음: ${nextStep(code, first?.candidates ? { candidates: first.candidates } : undefined).hint}`);
    return capLines(lines, (rest) => `… 외 ${rest}줄`);
  }
  const period = opts.period ?? periodFromDiff(p.diff);
  const f = (d: string) => dateFmt(d, period);
  const head = p.undoOf
    ? `미리보기 · ${opts.slug} (아직 적용 전) — 되돌리기 ${p.undoOf} · ${summaryText(p.summary) || "변경 없음"}`
    : `미리보기 · ${opts.slug} (아직 적용 전) — ${summaryText(p.summary) || "변경 없음"}`;
  const lines = [head];
  const depthOf = new Map<string, number>();
  const diffLines = p.diff.map((d) => diffLine(d, depthOf, opts, f));
  lines.push(...diffLines.slice(0, MAX_DIFF_LINES));
  if (diffLines.length > MAX_DIFF_LINES) lines.push(`… 외 ${diffLines.length - MAX_DIFF_LINES}건`);
  for (const w of (p.warnings ?? []).slice(0, 10)) lines.push(`경고${w.path ? ` ${w.path}` : w.nodeId ? ` #${w.nodeId}` : ""}: ${warnText(w)}`);
  if ((p.warnings?.length ?? 0) > 10) lines.push(`경고 외 ${p.warnings.length - 10}건`);
  lines.push(notificationText(p.notifications));
  const undo = p.undoOf ? null : undoableText(p.undoable);
  if (undo) lines.push(undo);
  if (p.previewId) lines.push(`previewId ${p.previewId}${p.expiresAt ? ` (${kst(p.expiresAt)} KST 까지)` : ""}`);
  const next = p.previewId ? `→ 다음: 사용자 승인 후 apply_curriculum_plan(previewId:"${p.previewId}")`
    : "→ 다음: previewId 가 없어 적용할 수 없어요 — 같은 계획으로 preview_curriculum_plan 을 다시 부르세요";
  const body = capLines(lines, (rest) => `… 외 ${rest}줄`);
  return `${body.length + next.length + 1 > MAX_TEXT ? body.slice(0, MAX_TEXT - next.length - 1) : body}\n${next}`;
}

/** 적용 결과 1~3줄 + 웹 링크 + ref→id + 되돌리기 안내 */
export function formatApply(a: ApplyData, opts: { slug: string; origin: string }): string {
  const notes = a.notifications && a.notifications.recipients > 0 ? `알림 ${a.notifications.recipients}명` : "알림 없음";
  const lines = [`${a.replayed ? "이미 적용됨(같은 previewId)" : "적용 완료"} — ${opts.slug} 진행목표: ${join(summaryText(a.summary), "·", notes).replace(/^· /, "")}`];
  lines.push(opts.origin.replace(/\/$/, "") + a.link);
  const refs = Object.entries(a.refs ?? {});
  if (refs.length) lines.push(`ref: ${refs.map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  else if (a.createdIds?.length) lines.push(`새 id: ${a.createdIds.join(", ")}`);
  if (a.undoable && a.undoable.ops > 0 && a.previewId) {
    lines.push(`되돌리려면 preview_curriculum_plan(study:"${opts.slug}", undo:"${a.previewId}") — 일정만, 그 뒤 일정이 바뀌면 거부`);
  }
  const nu = a.undoable?.notUndoable;
  if (nu && nu.created + nu.moved + nu.otherChanges > 0) lines.push("이동·생성·제목 등은 웹에서 고쳐야 해요");
  return capLines(lines, (rest) => `… 외 ${rest}줄`);
}

export type PersonalCreateData = {
  count: number; createdIds: string[]; remaining: number; round: { id: string; label: string | null; title: string };
  skipped: string[]; warnings: Warning[];
};
/** `n개 추가(3주차, 남은 자리 m) · 건너뜀(중복) k: …` + id · 경고 — 한 줄 */
export function formatPersonalResult(r: PersonalCreateData): string {
  const parts = [`${r.count}개 추가(${r.round.label || r.round.title}, 남은 자리 ${r.remaining})`];
  if (r.skipped.length) parts.push(`건너뜀(중복) ${r.skipped.length}: ${r.skipped.join(", ")}`);
  if (r.createdIds.length) parts.push(`id ${r.createdIds.join(", ")}`);
  for (const w of r.warnings) parts.push(`경고${w.nodeId ? ` ${w.nodeId}` : ""}: ${warnText(w)}`);
  return capLines([parts.join(" · ")], () => "…");
}

/** 〔C#10〕 `n개 삭제` + 이미 없는 id 가 있으면 ` · 이미 없음 k개` */
export function formatRemoveResult(r: { deleted: number; skipped: string[] }): string {
  return `${r.deleted}개 삭제${r.skipped.length ? ` · 이미 없음 ${r.skipped.length}개` : ""}`;
}
