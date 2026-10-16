import type { ApiError } from "@/lib/api/errors";
import type { Person, Submission, TaskDetail } from "@/lib/api/types";
import type { TaskStatus } from "@/lib/types";
import { dday, md, weekdayKo } from "@/lib/date";

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

/** 주 버튼 비활성 이유 (null = 제출 가능) — 순서: 연결 → 업로드 중 → 실패 줄 → 본문 길이 → 비어 있음 */
export function submitBlocker(d: { body: string; links: string[]; files: { status: string }[] }, online: boolean): string | null {
  if (!online) return "인터넷 연결을 확인해 주세요";
  if (d.files.some((f) => f.status === "uploading")) return "파일을 올리는 중이에요";
  if (d.files.some((f) => f.status === "error")) return "올리지 못한 파일을 빼거나 다시 올려 주세요";
  if (d.body.length > SUB_LIMITS.body) return `본문은 ${SUB_LIMITS.body.toLocaleString("en-US")}자까지예요`;
  if (d.body.trim() === "" && d.links.length === 0 && d.files.length === 0) return "내용·링크·파일 중 하나는 있어야 해요";
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
  if (d.today < d.node.startDate) return { kind: "blocked", note: `${md(d.node.startDate)}(${weekdayKo(d.node.startDate)})부터 제출할 수 있어요` };
  return mine ? { kind: "submitted" } : { kind: "compose" };
}

/** 주 버튼 문구 — 마감 = end 다음날 00:00 KST, 날짜 비교로 충분 */
export const submitLabel = (mine: Submission | null, today: string, end: string) =>
  mine ? "수정 저장" : today > end ? "지각 제출하기" : "제출하기";

/** 카드 머리 배지 */
export function myBadgeOf(d: TaskDetail): { status: TaskStatus; text: string } {
  const mine = d.mySubmission;
  if (mine) return mine.isLate ? { status: "late", text: "지각 제출" } : { status: "done", text: "기한내 제출" };
  const { startDate, endDate } = d.node;
  if (d.today < startDate) return { status: "planned", text: "예정" };
  if (d.today > endDate) return { status: "missed", text: "미제출 · 마감 지남" };
  return { status: "open", text: `제출 전 · ${dday(d.today, endDate)}` };
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

/** "처음 제출 … · 마지막 수정 …" — 수정이 처음 제출보다 60초 넘게 뒤일 때만 뒤 조각 */
export function metaLine(s: Pick<Submission, "firstSubmittedAt" | "updatedAt">): string {
  const head = `처음 제출 ${stampKst(s.firstSubmittedAt)}`;
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
