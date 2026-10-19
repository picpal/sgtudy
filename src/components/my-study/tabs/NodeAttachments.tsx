"use client";

import { useEffect, useId, useRef, useState, type Ref } from "react";
import type { ToastMsg } from "@/components/ui/Toast";
import { fetchNodeFiles, fetchNodeFilesOrEmpty, setNodeFiles } from "@/lib/api/nodeFiles";
import { fileUrl } from "@/lib/api/submission";
import type { FileMeta } from "@/lib/api/types";
import { fileBadge } from "../nodeFiles";
import { sizeText } from "../submission";
import { InlineConfirm } from "./InlineConfirm";

type ViewProps = { files: FileMeta[]; onOpen: (f: FileMeta) => void; onRemove?: (f: FileMeta) => void; busy?: string | null; /** 빼기 요청 중 — 모든 [빼기] 비활성 */ removing?: boolean; headingRef?: Ref<HTMLHeadingElement> };

/** 보기 상세의 "첨부 파일 n" 목록 — 0개면 아무것도 그리지 않는다 */
export function NodeAttachmentsView({ files, onOpen, onRemove, busy = null, removing = false, headingRef }: ViewProps) {
  const id = useId();
  if (files.length === 0) return null;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} ref={headingRef} tabIndex={-1} className="m-0 text-[14px] font-bold text-ink outline-none">
        첨부 파일 {files.length}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {files.map((f) => (
          <li key={f.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-line px-3 py-1">
            <span className="shrink-0 rounded-[6px] bg-surface-2 px-[6px] py-[2px] text-[11px] font-bold text-ink-3">{fileBadge(f.contentType)}</span>
            <span className="flex min-w-0 flex-[1_1_180px] flex-col">
              <span className="text-[14px] text-ink [overflow-wrap:anywhere]">{f.name}</span>
              <span className="text-[12px] text-muted">{sizeText(f.size)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <button type="button" aria-label={`${f.name} 받기`} disabled={busy === f.id} onClick={() => onOpen(f)} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-semibold text-ink disabled:opacity-50">
                받기
              </button>
              {onRemove && (
                <button type="button" aria-label={`${f.name} 빼기`} disabled={removing} onClick={() => onRemove(f)} className="h-11 rounded-[22px] px-3 text-[14px] font-semibold text-warn disabled:opacity-50">
                  빼기
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 컨테이너 — 마운트 후(effect)에만 불러온다. 서버가 볼 권한을 판단하므로 받은 것만 그린다 */
export function NodeAttachments({ nodeId, canRemove, toast }: { nodeId: string; canRemove: boolean; toast: (m: ToastMsg) => void }) {
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<FileMeta | null>(null);
  useEffect(() => {
    let live = true;
    fetchNodeFilesOrEmpty(nodeId)
      .then((l) => live && setFiles(l))
      .catch(() => live && setFiles([]));
    return () => {
      live = false;
    };
  }, [nodeId]);
  const open = async (f: FileMeta) => {
    setBusy(f.id);
    try {
      window.location.assign(await fileUrl(f));
    } catch {
      toast({ text: "파일을 열 수 없어요", tone: "bad" });
    } finally {
      setBusy(null);
    }
  };
  const heading = useRef<HTMLHeadingElement>(null);
  const [removing, setRemoving] = useState(false);
  const [said, setSaid] = useState("");
  const cancel = () => {
    setAsking(null);
    heading.current?.focus({ preventScroll: true });
  };
  // 마운트 뒤 소유자가 새 파일을 저장했을 수 있다 — 빼기 직전 최신 목록을 다시 받아 그 목록에서 f 만 뺀다 (남의 새 파일을 지우지 않게)
  const remove = async (f: FileMeta) => {
    if (removing) return;
    setRemoving(true);
    setAsking(null);
    try {
      const fresh = await fetchNodeFiles(nodeId);
      if (fresh.some((x) => x.id === f.id)) {
        setFiles(await setNodeFiles(nodeId, fresh.filter((x) => x.id !== f.id).map((x) => x.id)));
        setSaid(`‘${f.name}’을 뺐어요`);
      } else {
        setFiles(fresh);
        setSaid(`‘${f.name}’은 이미 빠져 있어요`);
      }
      heading.current?.focus({ preventScroll: true });
    } catch {
      toast({ text: "파일을 뺄 수 없어요", tone: "bad" });
    } finally {
      setRemoving(false);
    }
  };
  if (files.length === 0 && !said) return null;
  return (
    <div className="flex flex-col gap-2">
      <div role="status" aria-live="polite" className="sr-only">
        {said}
      </div>
      <NodeAttachmentsView files={files} busy={busy} removing={removing} headingRef={heading} onOpen={(f) => void open(f)} onRemove={canRemove ? setAsking : undefined} />
      {asking && <InlineConfirm text="이 파일을 목표에서 뺄까요? 팀원에게는 알리지 않아요" onCancel={cancel} actions={[{ label: "빼기", tone: "danger", onClick: () => void remove(asking) }]} />}
    </div>
  );
}
