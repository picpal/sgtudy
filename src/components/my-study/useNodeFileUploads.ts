"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { discardNodeUnattached, registerNodeFile } from "@/lib/api/nodeFiles";
import { roomIdOfNode } from "@/lib/api/submission";
import type { FileMeta } from "@/lib/api/types";
import { uploadAttachment, uploadErrorText, type UploadFailure } from "@/lib/api/upload";
import { NODE_FILE_LIMITS, nodeObjectKey, nodeRemovePlan, nodeRows } from "./nodeFiles";
import { checkFile } from "./submission";
import { slotsLeft, uploadsReducer, type UploadAction, type UploadRow } from "./uploads";

/* 진행목표 항목 첨부 업로드 큐 — useSubmissionComposer 의 업로드 큐와 같은 규칙(동시성 2·abort·미연결 정리).
   목록은 제어형: 붙은 파일 id 는 호출자(selected/onSelect)가 들고, 여기는 메타와 올리는 중·실패 줄만 든다.
   (제출 훅과의 중복은 의도된 트레이드오프 — 후속 정리 후보) */

type Args = {
  /** null(임시 행) → 고르기 비활성 */
  nodeId: string | null;
  /** 서버의 붙은 목록 */
  saved: FileMeta[];
  /** 제어형: 팀 = S.ov.files[id] ?? saved ids, 개인 = 폼 상태 */
  selected: string[];
  onSelect: (ids: string[]) => void;
  toast: (m: ToastMsg) => void;
};

type Act = UploadAction | { type: "reset" };
const reducer = (rows: UploadRow[], a: Act) => (a.type === "reset" ? [] : uploadsReducer(rows, a));

const CONCURRENCY = 2;
const isFailure = (e: unknown): e is UploadFailure => typeof e === "object" && e !== null && "status" in e && typeof (e as UploadFailure).status === "number";

export function useNodeFileUploads({ nodeId, saved, selected, onSelect, toast }: Args) {
  // 새로 등록된 메타 — saved 와 합쳐 줄을 그린다 (렌더 중 읽으므로 ref 가 아니라 state)
  const [added, setAdded] = useState<ReadonlyMap<string, FileMeta>>(new Map());
  const metas = useMemo(() => {
    const m = new Map(added);
    for (const f of saved) m.set(f.id, f);
    return m;
  }, [added, saved]);
  const [pending, dispatch] = useReducer(reducer, []);
  // 저장 응답 FILE_NOT_READY 로 표시할 붙은 파일 — fileId → 문구
  const [errs, setErrs] = useState<ReadonlyMap<string, string>>(new Map());
  // 저장돼 saved 가 바뀌면 그 파일의 오류 표시는 지운다 (렌더 중 state 맞추기 패턴)
  const [prevSaved, setPrevSaved] = useState(saved);
  if (prevSaved !== saved) {
    setPrevSaved(saved);
    if (saved.some((f) => errs.has(f.id)))
      setErrs((m) => {
        const n = new Map(m);
        for (const f of saved) n.delete(f.id);
        return n;
      });
  }

  const rows = useMemo(
    () => nodeRows(selected, metas, pending).map((r) => (r.status === "ready" && errs.has(r.fileId) ? { ...r, status: "error" as const, error: errs.get(r.fileId) } : r)),
    [selected, metas, pending, errs],
  );

  // 비동기 완료 시점에 최신 값을 읽는다 (ov 경합 방지)
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  const rowsRef = useRef(rows);
  const nodeRef = useRef(nodeId);
  useEffect(() => {
    selectedRef.current = selected;
    onSelectRef.current = onSelect;
    rowsRef.current = rows;
    nodeRef.current = nodeId;
  });
  const select = (ids: string[]) => {
    selectedRef.current = ids; // 다시 그려지기 전에 또 끝날 수 있어 바로 맞춰 둔다
    onSelectRef.current(ids);
  };
  const savedIds = useMemo(() => new Set(saved.map((f) => f.id)), [saved]);

  const files = useRef(new Map<string, { file: File; mime: string }>());
  const aborts = useRef(new Map<string, AbortController>());
  const queue = useRef<string[]>([]);
  const running = useRef(0);
  const roomId = useRef<{ node: string; p: Promise<string> } | null>(null);
  const alive = useRef(true);

  const pump = () => {
    while (running.current < CONCURRENCY && queue.current.length > 0) {
      const k = queue.current.shift()!;
      const item = files.current.get(k);
      if (!item) continue;
      const node = nodeRef.current;
      if (!node) {
        // 임시 행으로 바뀌었다 — 올리는 중으로 남지 않게 실패로 떨어뜨린다 (다시 시도 가능)
        dispatch({ type: "fail", key: k, error: "저장한 뒤 파일을 붙일 수 있어요" });
        continue;
      }
      running.current += 1;
      const ac = new AbortController();
      aborts.current.set(k, ac);
      void (async () => {
        try {
          if (roomId.current?.node !== node) roomId.current = { node, p: roomIdOfNode(node) };
          const room = await roomId.current.p;
          const path = nodeObjectKey(room, node, k, item.file.name);
          await uploadAttachment(path, item.file, item.mime, (pct) => dispatch({ type: "progress", key: k, progress: pct }), ac.signal);
          const meta = await registerNodeFile(node, { path, name: item.file.name, mime: item.mime, size: item.file.size });
          if (ac.signal.aborted || !alive.current) {
            // 등록 사이에 빼거나 화면을 떠났다 — 미연결 파일을 한도에서 뺀다(best effort)
            void discardNodeUnattached(meta.id);
            return;
          }
          setAdded((m) => new Map(m).set(meta.id, meta));
          files.current.delete(k);
          select([...selectedRef.current, meta.id]);
          dispatch({ type: "remove", key: k });
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

  const pick = (list: File[]) => {
    if (!nodeRef.current) {
      toast({ text: "저장한 뒤 파일을 붙일 수 있어요", tone: "bad" });
      return;
    }
    const added: UploadRow[] = [];
    for (const f of list) {
      const k = crypto.randomUUID();
      // 실패 줄도 자리를 차지한다 (slotsLeft 와 같은 셈)
      const check = checkFile(f, slotsLeft([...rowsRef.current, ...added], NODE_FILE_LIMITS.files));
      if (!check.ok) {
        added.push({ key: k, fileId: "", name: f.name, size: f.size, status: "error", progress: 0, error: check.error });
        continue;
      }
      files.current.set(k, { file: f, mime: check.mime });
      added.push({ key: k, fileId: k, name: f.name, size: f.size, status: "uploading", progress: 0 });
      queue.current.push(k);
    }
    for (const row of added) dispatch({ type: "add", row });
    rowsRef.current = [...rowsRef.current, ...added];
    pump();
  };

  const remove = (row: UploadRow) => {
    const plan = nodeRemovePlan(row, savedIds);
    if (plan === "abort") {
      queue.current = queue.current.filter((k) => k !== row.key);
      aborts.current.get(row.key)?.abort();
    }
    files.current.delete(row.key);
    dispatch({ type: "remove", key: row.key });
    if (row.fileId && selectedRef.current.includes(row.fileId)) select(selectedRef.current.filter((id) => id !== row.fileId));
    if (plan === "discard") void discardNodeUnattached(row.fileId);
    if (errs.has(row.fileId))
      setErrs((m) => {
        const n = new Map(m);
        n.delete(row.fileId);
        return n;
      });
    rowsRef.current = rowsRef.current.filter((r) => r.key !== row.key);
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

  const markError = (fileId: string, error: string) => setErrs((m) => new Map(m).set(fileId, error));

  /** 등록됐지만 아직 저장(node_files_set)하지 않은 파일을 버린다 — 취소·떠나기 (useSubmissionComposer.cancel 과 같은 역할).
      선택 id(ov/폼 상태)는 호출자가 함께 지운다 */
  const discardUnsaved = () => {
    queue.current = [];
    for (const ac of aborts.current.values()) ac.abort(); // 등록 중이던 건 등록 뒤 버려진다
    for (const id of added.keys()) if (!savedIds.has(id)) void discardNodeUnattached(id);
    files.current.clear();
    setAdded(new Map());
    setErrs(new Map());
    dispatch({ type: "reset" });
    rowsRef.current = rowsRef.current.filter((r) => r.status === "ready" && savedIds.has(r.fileId));
  };

  const uploading = pending.some((r) => r.status === "uploading");

  return { rows, pick, remove, retry, canRetry, uploading, markError, discardUnsaved };
}
