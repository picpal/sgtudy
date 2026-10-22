"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { discardUnattached, registerFile, roomIdOfNode, upsertSubmission } from "@/lib/api/submission";
import type { Submission, TaskDetail } from "@/lib/api/types";
import { uploadAttachment, uploadErrorText, type UploadFailure } from "@/lib/api/upload";
import { routes } from "@/lib/routes";
import { addLink as addLinkRule, checkFile, emptyAllowed, objectKey, isPersonalDetail, savedToast, submitBlocker, submitErrorAction, submitLabel, withPendingLink } from "./submission";
import { clearDraft, contentDiffers, draftDiffers, draftKey, readDraft, writeDraft, type Draft } from "./submissionDraft";
import { fromSaved, readyIds, removePlanOf, slotsLeft, uploadsReducer, type UploadAction, type UploadRow } from "./uploads";

/* 작성 상태 · 업로드 큐 · 이 기기 임시 저장 · 제출 (스펙 §2.3·§2.7·§2.8).
   서버 저장은 주 버튼(submit)에서만 — 임시 저장은 localStorage 만 쓴다 (Review Focus 1) */

type Args = {
  nodeId: string;
  userId: string;
  detail: TaskDetail;
  /** 서버가 돌려준 Submission — 응답으로만 화면을 바꾼다 (R4) */
  onSaved: (s: Submission) => void;
  onRefetch: () => void;
  toast: (m: ToastMsg) => void;
};

type Act = UploadAction | { type: "reset"; rows: UploadRow[] };
const reducer = (rows: UploadRow[], a: Act) => (a.type === "reset" ? a.rows : uploadsReducer(rows, a));

const CONCURRENCY = 2;
const store = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};
const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
const baseOf = (s: Submission | null) => (s ? { body: s.bodyMd, links: s.links, fileIds: s.files.map((f) => f.id) } : null);
const isFailure = (e: unknown): e is UploadFailure => typeof e === "object" && e !== null && "status" in e && typeof (e as UploadFailure).status === "number";

export type Composer = ReturnType<typeof useSubmissionComposer>;

export function useSubmissionComposer({ nodeId, userId, detail, onSaved, onRefetch, toast }: Args) {
  const router = useRouter();
  const mine = detail.mySubmission;
  const key = draftKey(nodeId, userId);

  const [body, setBodyRaw] = useState(mine?.bodyMd ?? "");
  const [links, setLinks] = useState<string[]>(mine?.links ?? []);
  const [linkInput, setLinkInput] = useState("");
  const [linkError, setLinkError] = useState<{ index: number | null; text: string } | null>(null);
  const [rows, dispatch] = useReducer(reducer, mine?.files ?? [], fromSaved);
  const [busy, setBusy] = useState(false);
  // 서버 값과 다른 이 기기 임시본 — 고를 때까지 안내를 띄운다
  // 카드는 task_get 응답 뒤(클라이언트)에만 그려져 첫 렌더에서 localStorage 를 읽어도 된다
  const [pending, setPending] = useState<Draft | null>(() => {
    const d = readDraft(store(), draftKey(nodeId, userId));
    const saved = mine ? { bodyMd: mine.bodyMd, links: mine.links, files: mine.files } : null;
    return d && draftDiffers(d, saved) ? d : null;
  });
  // 사용자가 손댄 뒤에만 임시본을 쓴다 (열자마자 남은 임시본을 덮어쓰지 않게)
  const [dirty, setDirty] = useState(false);
  // "바뀐 것" 의 기준 — 저장된 제출, [이어 쓰기] 로 연 임시본이면 그 임시본 (나가기 확인)
  const [base, setBase] = useState(() => baseOf(mine));
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });
  const busyRef = useRef(false);
  const savedIds = useMemo(() => new Set((mine?.files ?? []).map((f) => f.id)), [mine]);

  // 남은 임시본은 [이어 쓰기]·[버리기] 로 고를 때까지 지킨다 — 손댔다고 덮어쓰면 안내만 사라지고 내용이 없어진다
  const touch = () => setDirty(true);
  const setBody = (v: string) => {
    setBodyRaw(v);
    touch();
  };

  /* ---------- 업로드 큐 ---------- */
  const files = useRef(new Map<string, { file: File; mime: string }>());
  const aborts = useRef(new Map<string, AbortController>());
  const queue = useRef<string[]>([]);
  const running = useRef(0);
  const roomId = useRef<Promise<string> | null>(null);
  const alive = useRef(true);

  const pump = () => {
    while (running.current < CONCURRENCY && queue.current.length > 0) {
      const k = queue.current.shift()!;
      const item = files.current.get(k);
      if (!item) continue;
      running.current += 1;
      const ac = new AbortController();
      aborts.current.set(k, ac);
      void (async () => {
        try {
          roomId.current ??= roomIdOfNode(nodeId);
          const room = await roomId.current;
          const path = objectKey(room, nodeId, userId, k, item.file.name);
          await uploadAttachment(path, item.file, item.mime, (pct) => dispatch({ type: "progress", key: k, progress: pct }), ac.signal);
          const meta = await registerFile(nodeId, { path, name: item.file.name, mime: item.mime, size: item.file.size });
          if (ac.signal.aborted || !alive.current) {
            // 등록 사이에 빼거나 화면을 떠났다 — 미연결 파일을 한도에서 뺀다(best effort)
            void discardUnattached(meta.id);
            return;
          }
          dispatch({ type: "ready", key: k, meta });
        } catch (e) {
          if (ac.signal.aborted || !alive.current) return;
          if (isFailure(e)) dispatch({ type: "fail", key: k, error: uploadErrorText(e.status) });
          else {
            roomId.current = null; // room id 조회 실패면 다음 시도에 다시
            dispatch({ type: "fail", key: k, error: toApiError(e).message });
          }
        } finally {
          aborts.current.delete(k);
          running.current -= 1;
          if (alive.current) pump();
        }
      })();
    }
  };

  useEffect(() => {
    alive.current = true;
    const ab = aborts.current;
    return () => {
      alive.current = false;
      queue.current = [];
      for (const ac of ab.values()) ac.abort();
    };
  }, []);

  const pick = (list: Iterable<File>) => {
    const added: UploadRow[] = [];
    for (const f of list) {
      const k = crypto.randomUUID();
      // 실패 줄도 자리를 차지한다 (slotsLeft 와 같은 셈)
      const check = checkFile(f, slotsLeft([...rowsRef.current, ...added]));
      if (!check.ok) {
        added.push({ key: k, fileId: "", name: f.name, size: f.size, status: "error", progress: 0, error: check.error });
        continue;
      }
      files.current.set(k, { file: f, mime: check.mime });
      added.push({ key: k, fileId: k, name: f.name, size: f.size, status: "uploading", progress: 0 });
      queue.current.push(k);
    }
    for (const row of added) dispatch({ type: "add", row });
    // 다시 그려지기 전에 또 고를 수 있어 바로 맞춰 둔다
    rowsRef.current = [...rowsRef.current, ...added];
    touch();
    pump();
  };

  const remove = (row: UploadRow) => {
    const plan = removePlanOf(row, savedIds);
    if (plan === "abort") {
      queue.current = queue.current.filter((k) => k !== row.key);
      aborts.current.get(row.key)?.abort();
    }
    if (plan === "discard") void discardUnattached(row.fileId); // D1 미정 — 0015 가 없으면 목록에서만 빠진다
    files.current.delete(row.key);
    dispatch({ type: "remove", key: row.key });
    rowsRef.current = rowsRef.current.filter((r) => r.key !== row.key);
    touch();
  };

  const canRetry = (row: UploadRow) => row.status === "error" && files.current.has(row.key);
  const retry = (row: UploadRow) => {
    const item = files.current.get(row.key);
    if (!item) return;
    files.current.delete(row.key);
    dispatch({ type: "remove", key: row.key });
    rowsRef.current = rowsRef.current.filter((r) => r.key !== row.key);
    pick([item.file]);
  };

  /* ---------- 링크 ---------- */
  const addLink = () => {
    const r = addLinkRule(linkInput, links);
    if (!r.ok) {
      setLinkError(r.error ? { index: null, text: r.error } : null);
      return;
    }
    setLinks(r.links);
    setLinkInput("");
    setLinkError(null);
    touch();
  };
  const removeLink = (i: number) => {
    setLinks((l) => l.filter((_, j) => j !== i));
    setLinkError(null);
    touch();
  };
  const typeLink = (v: string) => {
    setLinkInput(v);
    touch();
    if (linkError?.index === null) setLinkError(null);
  };

  /* ---------- 이 기기 임시 저장 (500ms 디바운스) — 사고(탭 닫힘·새로고침) 대비 안전망. 나가기 확인을 대신하지 않는다 ---------- */
  const readyFiles = useMemo(() => rows.filter((r) => r.status === "ready" && r.meta).map((r) => r.meta!), [rows]);
  const readyKey = readyFiles.map((f) => f.id).join(",");
  const changed = contentDiffers({ body, links, fileIds: readyKey ? readyKey.split(",") : [] }, base);
  useEffect(() => {
    if (!dirty || pending) return;
    const t = setTimeout(() => {
      // 공백뿐이거나 기준과 같으면 임시본을 남기지 않는다
      if (changed) writeDraft(store(), key, { body, links, files: readyFiles, at: new Date().toISOString() });
      else clearDraft(store(), key);
    }, 500);
    return () => clearTimeout(t);
  }, [dirty, pending, changed, body, links, readyFiles, key]);

  const uploading = rows.some((r) => r.status === "uploading");
  /** 나가기 전에 물을 것이 있나 — 손댔고, 기준과 다르거나(본문 공백 무시) 입력칸에 링크가 남았거나 올리는 중 */
  const unsaved = dirty && (changed || linkInput.trim() !== "" || uploading);
  // 새로고침·닫기 → 브라우저 확인
  useEffect(() => {
    if (!unsaved) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [unsaved]);

  /** 서버 값(또는 임시본)으로 작성 화면을 채운다 — [수정하기]·[이어 쓰기]·[취소] */
  const load = (src: { body: string; links: string[]; files: Draft["files"] }) => {
    queue.current = [];
    for (const ac of aborts.current.values()) ac.abort();
    files.current.clear();
    setBodyRaw(src.body);
    setLinks(src.links);
    setLinkInput("");
    setLinkError(null);
    dispatch({ type: "reset", rows: fromSaved(src.files) });
    rowsRef.current = fromSaved(src.files);
  };
  const fromMine = () => ({ body: mine?.bodyMd ?? "", links: mine?.links ?? [], files: mine?.files ?? [] });

  const resume = () => {
    if (!pending) return;
    load(pending);
    setBase({ body: pending.body, links: pending.links, fileIds: pending.files.map((f) => f.id) });
    setPending(null);
    setDirty(true);
  };
  const dropDraft = () => {
    clearDraft(store(), key);
    setPending(null);
  };
  /** 수정 취소 — 임시본을 지우고, 올렸지만 저장하지 않은 파일은 한도에서 뺀다 */
  const cancel = () => {
    for (const r of rowsRef.current) if (r.status === "ready" && !savedIds.has(r.fileId)) void discardUnattached(r.fileId);
    load(fromMine());
    clearDraft(store(), key);
    setPending(null);
    setDirty(false);
    setBase(baseOf(mine));
  };
  /** 나가기 확인 [임시저장] — 지금 내용을 이 기기 임시본으로 바로 쓴다(입력칸의 유효한 링크 포함). 못 쓰면 false */
  const keepDraft = (): boolean => writeDraft(store(), key, { body, links: withPendingLink(linkInput, links).links, files: readyFiles, at: new Date().toISOString() });
  const reset = () => {
    load(fromMine());
    setDirty(false);
    setBase(baseOf(mine));
  };

  /* ---------- 제출 ---------- */
  const personal = isPersonalDetail(detail);
  // 완료한 개인 기록은 모두 비워도 저장된다 (QA Q1-2) — 팀 과제는 하나는 있어야
  // 입력칸에 남은 링크 — 유효하면 제출에 포함한다 (시나리오 QA #3)
  const pendingLink = withPendingLink(linkInput, links);
  const blocker = submitBlocker({ body, links: pendingLink.links, files: rows }, online, { allowEmpty: emptyAllowed(personal, mine) });
  const label = submitLabel(mine, detail.today, detail.node.endDate, personal);
  const submit = async () => {
    if (busyRef.current || blocker) return;
    if (pendingLink.error) {
      // 틀린 주소를 조용히 버리지 않는다 — 고치거나 지운 뒤 다시 누르게
      setLinkError({ index: null, text: `${pendingLink.error} · 고치거나 지운 뒤 다시 제출해 주세요` });
      return;
    }
    const sendLinks = pendingLink.links;
    busyRef.current = true;
    setBusy(true);
    try {
      const sub = await upsertSubmission(nodeId, { body, links: sendLinks, fileIds: readyIds(rowsRef.current) });
      if (pendingLink.included) {
        setLinks(sendLinks);
        setLinkInput("");
      }
      clearDraft(store(), key);
      setPending(null);
      setDirty(false);
      setBase(baseOf(sub));
      toast({ text: savedToast(!!mine, sub.isLate, personal), tone: "ok" });
      onSaved(sub);
    } catch (e) {
      const a = submitErrorAction(toApiError(e));
      if (a.kind === "refetch") {
        toast({ text: a.text, tone: "bad" });
        onRefetch();
      } else if (a.kind === "file") {
        dispatch({ type: "markError", fileId: a.fileId, error: a.text });
        toast({ text: "다시 올려야 하는 파일이 있어요", tone: "bad" });
      } else if (a.kind === "link") {
        // 입력칸에서 함께 보낸 링크(목록 밖 index)는 입력칸 오류로
        setLinkError({ index: a.index < links.length ? a.index : null, text: a.text });
      } else if (a.kind === "login") {
        toast({ text: a.text, tone: "bad" });
        router.push(routes.login(window.location.pathname + window.location.search));
      } else toast({ text: a.text, tone: "bad" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return {
    mine,
    /** 이 화면에서 무언가 바꿨다 — 수정 취소 전에 묻는다 (Q1-11) */
    dirty,
    /** 나가기 전에 물을 것이 있다 (공백뿐·기준과 같음은 아니다) */
    unsaved,
    keepDraft,
    body,
    setBody,
    links,
    linkInput,
    typeLink,
    addLink,
    removeLink,
    linkError,
    rows,
    pick,
    remove,
    retry,
    canRetry,
    uploading,
    pending,
    resume,
    dropDraft,
    cancel,
    reset,
    online,
    busy,
    blocker,
    label,
    submit,
  };
}
