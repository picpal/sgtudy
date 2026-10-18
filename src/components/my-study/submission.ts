import type { ApiError } from "@/lib/api/errors";
import type { Person, Submission, TaskDetail } from "@/lib/api/types";
import type { TaskStatus } from "@/lib/types";
import { dday, md, weekdayKo } from "@/lib/date";
import { STATUS_CODE, codeLabel } from "./model";

/* 과제 제출 순수 로직 (스펙 2026-10-16-task-submission-design §1.3·§2). React·Supabase 무관 */

/** D10 제한값 — 0007:113-136, 버킷 0003:136-141 */
export const SUB_LIMITS = { body: 50_000, bodyWarn: 45_000, links: 20, linkLen: 2000, files: 5, fileBytes: 10_485_760 } as const;

/** 0007:13-14 allowed_mime_types() 와 같은 9개 */
export const ALLOWED_MIME: readonly string[] = [
  "image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf",
  "application/zip", "application/x-zip-compressed", "text/plain", "text/markdown",
];

/** file.type 이 빈 문자열일 때 확장자로 보완 */
const EXT_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf", zip: "application/zip", txt: "text/plain", md: "text/markdown", markdown: "text/markdown",
};

/** 파일 고르기 accept 속성 */
export const ACCEPT = [...ALLOWED_MIME, ...Object.keys(EXT_MIME).map((e) => `.${e}`)].join(",");

/** 키 확장자 — 서버 정규식 `\.[a-z0-9]{1,10}` (0007:193-194). 맞지 않으면 null(키에서 생략) */
export function extOf(name: string): string | null {
  const i = name.lastIndexOf(".");
  if (i <= 0) return null; // 점 없음 · ".env" 처럼 점으로 시작하는 이름 전체
  const ext = name.slice(i + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : null;
}

/** `{room}/{node}/{user}/{uuid}[.ext]` — 원본명은 키에 넣지 않는다 (0007:168-169) */
export const objectKey = (roomId: string, nodeId: string, userId: string, uuid: string, name: string) => {
  const ext = extOf(name);
  return `${roomId}/${nodeId}/${userId}/${uuid}${ext ? `.${ext}` : ""}`;
};

export function mimeOf(f: { name: string; type: string }): string | null {
  if (f.type === "") {
    const ext = extOf(f.name);
    return ext ? EXT_MIME[ext] ?? null : null;
  }
  return ALLOWED_MIME.includes(f.type) ? f.type : null;
}

export type FileCheck = { ok: true; mime: string } | { ok: false; error: string };

/** 올리기 전 거절 — 순서: 자리 → 형식 → 빈 파일 → 크기 */
export function checkFile(f: { name: string; type: string; size: number }, slotsLeft: number): FileCheck {
  if (slotsLeft <= 0) return { ok: false, error: `첨부는 ${SUB_LIMITS.files}개까지예요` };
  const mime = mimeOf(f);
  if (!mime) return { ok: false, error: "올릴 수 없는 형식이에요" };
  if (f.size <= 0) return { ok: false, error: "빈 파일은 올릴 수 없어요" };
  if (f.size > SUB_LIMITS.fileBytes) return { ok: false, error: "10MB를 넘는 파일이에요" };
  return { ok: true, mime };
}

export type LinkAdd = { ok: true; links: string[] } | { ok: false; error: string };

/** 링크 추가 — 서버 규칙(0007:116-125): trim, ≤20개, ^https?://\S+$, ≤2000자. 빈 입력은 error "" (조용히 무시) */
export function addLink(raw: string, links: string[]): LinkAdd {
  const url = raw.trim();
  if (url === "") return { ok: false, error: "" };
  if (links.length >= SUB_LIMITS.links) return { ok: false, error: `링크는 ${SUB_LIMITS.links}개까지예요` };
  if (!/^https?:\/\/\S+$/i.test(url)) return { ok: false, error: "http:// 또는 https:// 로 시작하는 주소만 넣을 수 있어요" };
  if (url.length > SUB_LIMITS.linkLen) return { ok: false, error: `링크는 ${SUB_LIMITS.linkLen.toLocaleString("en-US")}자까지예요` };
  if (links.includes(url)) return { ok: false, error: "이미 넣은 링크예요" };
  return { ok: true, links: [...links, url] };
}

/**
 * 제출할 때 입력칸에 남은 링크 — [추가]를 안 눌러도 유효하면 포함하고, 틀렸으면 제출을 막는다 (시나리오 QA #3).
 * 이미 넣은 링크는 그대로 둔다(오류 아님).
 */
export function withPendingLink(raw: string, links: string[]): { links: string[]; error: string | null; included: boolean } {
  const r = addLink(raw, links);
  if (r.ok) return { links: r.links, error: null, included: true };
  if (r.error === "" || links.includes(raw.trim())) return { links, error: null, included: false };
  return { links, error: r.error, included: false };
}

export const EMPTY_BLOCKER = "내용·링크·파일 중 하나는 있어야 해요";

/**
 * 빈 저장을 허용하나 — 이미 완료한 개인 목표 기록만 (QA Q1-2). 비워 저장하면 완료(빈 제출)는 남고, 그 뒤 완료 취소가 된다.
 * 팀 과제의 "하나는 있어야" 는 화면(EMPTY_BLOCKER)과 서버(0022 submission_upsert — SUBMISSION_EMPTY) 양쪽 규칙이다.
 * 서버도 개인 목표(PERSONAL)만 빈 저장을 받는다.
 */
export const emptyAllowed = (personal: boolean, mine: Submission | null): boolean => personal && mine !== null;

const isEmptyDraft = (d: { body: string; links: string[]; files: unknown[] }) => d.body.trim() === "" && d.links.length === 0 && d.files.length === 0;

/** 주 버튼 비활성 이유 (null = 제출 가능) — 순서: 연결 → 업로드 중 → 실패 줄 → 본문 길이 → 비어 있음(allowEmpty 면 통과) */
export function submitBlocker(d: { body: string; links: string[]; files: { status: string }[] }, online: boolean, opts: { allowEmpty?: boolean } = {}): string | null {
  if (!online) return "인터넷 연결을 확인해 주세요";
  if (d.files.some((f) => f.status === "uploading")) return "파일을 올리는 중이에요";
  if (d.files.some((f) => f.status === "error")) return "올리지 못한 파일을 빼거나 다시 올려 주세요";
  if (d.body.length > SUB_LIMITS.body) return `본문은 ${SUB_LIMITS.body.toLocaleString("en-US")}자까지예요`;
  if (!opts.allowEmpty && isEmptyDraft(d)) return EMPTY_BLOCKER;
  return null;
}

export type RoomStatus = "draft" | "recruit" | "active" | "ended";
export type MyCardState =
  | { kind: "hidden" }
  | { kind: "readonly"; note: string }
  | { kind: "blocked"; note: string }
  | { kind: "submitted" }
  | { kind: "compose" };

const ARCHIVED_NOTE = "보관된 과제라 제출·수정할 수 없어요";

/** 내 제출 카드 상태 — 스펙 §2.2 표, 위에서부터 첫 일치 (Review Focus 2) */
export function myCardStateOf(d: TaskDetail, room: RoomStatus): MyCardState {
  const mine = d.mySubmission;
  // 리프를 보관하면 배정이 풀려(isAssignee=false) 아래 "담당에서 빠져" 로 떨어지므로 보관을 먼저 본다
  if (d.node.archived && mine && !d.isAssignee) return { kind: "readonly", note: ARCHIVED_NOTE };
  if (!d.isAssignee) return mine ? { kind: "readonly", note: "담당에서 빠져 더 고칠 수 없어요 · 제출물은 남아 있어요" } : { kind: "hidden" };
  if (room === "ended") return mine ? { kind: "readonly", note: "종료된 스터디라 더 고칠 수 없어요" } : { kind: "blocked", note: "종료된 스터디라 제출할 수 없어요" };
  if (room !== "active") return { kind: "blocked", note: "스터디가 시작되면 제출할 수 있어요" };
  if (d.node.archived) return mine ? { kind: "readonly", note: ARCHIVED_NOTE } : { kind: "blocked", note: ARCHIVED_NOTE };
  // 개인 목표는 본인이 기간을 정하므로 시작일 전에도 제출할 수 있다 (서버 0017 submission_upsert 와 같은 규칙)
  if (d.today < d.node.startDate && d.node.task?.type !== "personal") return { kind: "blocked", note: `${md(d.node.startDate)}(${weekdayKo(d.node.startDate)})부터 제출할 수 있어요` };
  return mine ? { kind: "submitted" } : { kind: "compose" };
}

/** 리프 설명이 비었을 때 안내 — 개인 목표는 "과제" 라 부르지 않는다 */
export const emptyDescText = (personal: boolean) => (personal ? "설명이 아직 없어요" : "과제 설명이 아직 없어요");

/** 주 버튼 문구 — 마감 = end 다음날 00:00 KST, 날짜 비교로 충분. 개인 목표는 늘 "저장" (시안 A-7) */
export const submitLabel = (mine: Submission | null, today: string, end: string, personal = false) =>
  personal ? "저장" : mine ? "수정 저장" : today > end ? "지각 제출하기" : "제출하기";

/** 저장 성공 토스트 — 개인 목표는 "저장했어요", 처음 저장이면 완료도 됐다고 알린다 (QA Q1-3) */
export const savedToast = (edited: boolean, isLate: boolean, personal: boolean): string =>
  personal ? (edited ? "저장했어요" : "저장했어요 · 완료로 표시했어요") : edited ? "수정했어요" : isLate ? "지각 제출했어요" : "제출했어요";

/** 개인 목표 상세인가 — 제출 카드 문구를 완료 문구로 (스펙 §6) */
export const isPersonalDetail = (d: TaskDetail): boolean => d.node.task?.type === "personal";

/** 카드 머리 배지 — 개인 목표는 model.codeLabel 과 같은 문구(기한내 완료 · 늦게 완료 · 기한 지남) */
export function myBadgeOf(d: TaskDetail): { status: TaskStatus; text: string } {
  const personal = isPersonalDetail(d);
  const mine = d.mySubmission;
  const label = (status: TaskStatus) => ({ status, text: codeLabel({ personal }, STATUS_CODE[status]) });
  if (mine) return label(mine.isLate ? "late" : "done");
  const { startDate, endDate } = d.node;
  if (d.today < startDate) return { status: "planned", text: "예정" };
  if (d.today > endDate) return personal ? label("missed") : { status: "missed", text: "미제출 · 마감 지남" };
  return { status: "open", text: `${personal ? "완료 전" : "제출 전"} · ${dday(d.today, endDate)}` };
}

/** "모든 담당자가 제출했어요" 배너 — 1인 개인 목표에는 뜻이 없다 */
export const showAllSubmitted = (d: TaskDetail): boolean => d.allSubmitted && !isPersonalDetail(d);

/** 저장된 내 제출의 지각 안내 */
export const lateNote = (personal: boolean): string => (personal ? "마감 뒤에 완료해 늦게 완료로 기록됐어요" : "마감 뒤에 처음 제출해 지각으로 기록됐어요");

/** 현황 머리 — 팀 "제출 현황 n/m", 개인은 소유자 한 줄뿐이라 개수 없이 (보관이면 서버가 0/0 을 준다 — 스펙 §5.3) */
export const statusHeadOf = (personal: boolean, sub: number, asg: number): string => (personal ? "완료 현황" : `제출 현황 ${sub}/${asg}`);

/** 현황 줄 상태 문구 — 개인은 codeLabel. 보관된 개인 목표는 완료했을 때만(그 밖은 "보관됨" 표시가 대신한다) */
export function rowStatusText(status: TaskStatus, personal: boolean, archived: boolean): string | null {
  if (personal && archived && status !== "done" && status !== "late") return null;
  return codeLabel({ personal }, STATUS_CODE[status]);
}

/** 내 카드가 없을 때(담당 아님) 안내 */
export const notAssignedText = (personal: boolean): string => (personal ? "팀원의 개인 목표예요" : "담당 과제가 아니에요 · 제출 현황만 볼 수 있어요");

/** 개인 목표 처음 작성 — 저장 = 완료임을 저장 전에 알린다 (QA Q1-3) */
export const PERSONAL_SAVE_NOTE = "기록을 저장하면 완료로 표시돼요";

/**
 * 작성 화면 왼쪽 안내 + 경고색 여부 (Ruling: 빈 상태는 처음엔 중립색, 입력했다 비웠을 때만 경고색 — 팀·개인 공통).
 * 개인 목표 첫 작성은 "저장 = 완료" 와 "완료로 표시"(내용 없는 완료)를 함께 알린다.
 * 완료한 개인 기록을 모두 비우면(empty, 저장 가능) 완료는 남고 그 뒤 취소할 수 있음을 알린다 (QA Q1-2).
 */
export function composerHint(o: { blocker: string | null; editing: boolean; late: boolean; personal: boolean; touched: boolean; empty?: boolean }): { text: string | null; warn: boolean } {
  const firstPersonal = o.personal && !o.editing;
  if (o.blocker === EMPTY_BLOCKER) {
    const text = firstPersonal ? `${PERSONAL_SAVE_NOTE} · 내용 없이 완료하려면 위의 '완료로 표시'를 쓰세요` : EMPTY_BLOCKER;
    return { text, warn: o.touched };
  }
  if (o.blocker) return { text: o.blocker, warn: true };
  if (o.editing) {
    if (o.personal && o.empty) return { text: "비운 채 저장해도 완료는 그대로예요 · 저장한 뒤 '완료 취소'를 누를 수 있어요", warn: false };
    return { text: o.personal ? "마감 뒤에 고쳐도 늦게 완료 여부는 처음 완료 시각으로 정해져요" : "마감 뒤에 고쳐도 지각 여부는 처음 제출 시각으로 정해져요", warn: false };
  }
  if (firstPersonal) return { text: o.late ? `${PERSONAL_SAVE_NOTE} · 마감이 지나 늦게 완료로 기록돼요` : PERSONAL_SAVE_NOTE, warn: false };
  if (o.late) return { text: "마감이 지나 지각으로 기록돼요", warn: false };
  return { text: null, warn: false };
}

const KST = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** ISO 시각 → "10.12(월) 12:00" (KST) */
export function stampKst(iso: string): string {
  const p = Object.fromEntries(KST.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const ymd = `${p.year}-${p.month}-${p.day}`;
  return `${md(ymd)}(${weekdayKo(ymd)}) ${p.hour}:${p.minute}`;
}

/** "처음 제출 … · 마지막 수정 …" (개인 목표는 "완료 …") — 수정이 처음 제출보다 60초 넘게 뒤일 때만 뒤 조각 */
export function metaLine(s: Pick<Submission, "firstSubmittedAt" | "updatedAt">, personal = false): string {
  const head = `${personal ? "완료" : "처음 제출"} ${stampKst(s.firstSubmittedAt)}`;
  const edited = Date.parse(s.updatedAt) - Date.parse(s.firstSubmittedAt) > 60_000;
  return edited ? `${head} · 마지막 수정 ${stampKst(s.updatedAt)}` : head;
}

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export type StatusRow = {
  userId: string;
  name: string;
  tone: Person["tone"];
  status: TaskStatus;
  me: boolean;
  /** 담당자가 아닌데 제출이 있는 사람(해제·이탈) */
  released: boolean;
  /** task_get.submissions 에 있는 것만 — 없으면 null (Review Focus 4) */
  submission: (Submission & { author: Person }) | null;
};

/** 제출 현황 줄 — people 순서 + 그 뒤 담당 아닌 제출자. 보관 리프(people 비어 있음)는 submissions 로만 */
export function statusRows(d: TaskDetail, meId: string | null): StatusRow[] {
  const people = d.node.task?.people ?? [];
  const byUser = new Map(d.submissions.map((s) => [s.author.userId, s]));
  const subStatus = (s: Submission): TaskStatus => (s.isLate ? "late" : "done");
  const rows: StatusRow[] = people.map((p) => {
    const s = byUser.get(p.userId) ?? null;
    return { userId: p.userId, name: p.nickname, tone: p.tone, status: s ? subStatus(s) : p.status, me: p.userId === meId, released: false, submission: s };
  });
  const assigned = new Set(people.map((p) => p.userId));
  for (const s of d.submissions) {
    if (assigned.has(s.author.userId)) continue;
    const a = s.author;
    rows.push({ userId: a.userId, name: a.nickname, tone: a.tone, status: subStatus(s), me: a.userId === meId, released: people.length > 0, submission: s });
  }
  return rows;
}

/** 진입 포커스 대상 — 작성 가능한 미제출 담당자만 내 카드, 그 외 현황 (스펙 §2.6) */
export const focusTargetOf = (s: MyCardState): "mine" | "status" => (s.kind === "compose" ? "mine" : "status");

export type SubmitErrorAction =
  | { kind: "refetch"; text: string }
  | { kind: "file"; fileId: string; text: string }
  | { kind: "link"; index: number; text: string }
  | { kind: "login"; text: string }
  | { kind: "toast"; text: string };

const REFETCH = new Set(["TASK_NOT_ASSIGNED", "TASK_ARCHIVED", "PARENT_ARCHIVED", "ROOM_NOT_ACTIVE", "TASK_NOT_STARTED", "NODE_NOT_FOUND"]);

/** submission_upsert 실패 → 화면 동작 */
export function submitErrorAction(e: ApiError): SubmitErrorAction {
  if (REFETCH.has(e.code)) return { kind: "refetch", text: e.message };
  const fileId = e.details?.fileId;
  if ((e.code === "FILE_NOT_READY" || e.code === "NOT_FOUND") && fileId) return { kind: "file", fileId: String(fileId), text: "이 파일을 다시 올려 주세요" };
  if (e.code === "INVALID_LINK" && e.details?.index != null && Number.isInteger(Number(e.details.index)))
    return { kind: "link", index: Number(e.details.index), text: e.message };
  if (e.code === "AUTH_REQUIRED") return { kind: "login", text: e.message };
  if (e.code === "UNKNOWN") return { kind: "toast", text: "제출하지 못했어요 · 연결을 확인하고 다시 눌러 주세요" };
  return { kind: "toast", text: e.message };
}
