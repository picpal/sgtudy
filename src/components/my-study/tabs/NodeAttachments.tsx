"use client";

import { useEffect, useId, useRef, useState, type Ref } from "react";
import type { ToastMsg } from "@/components/ui/Toast";
import { fetchNodeFiles, setNodeFiles } from "@/lib/api/nodeFiles";
import { fileUrl } from "@/lib/api/submission";
import type { FileMeta } from "@/lib/api/types";
import { isImageMime, isSvgMime } from "@/lib/files/imageMime";
import { ZoomIcon } from "../MarkdownView";
import { fileBadge } from "../nodeFiles";
import { sizeText } from "../submission";
import { InlineConfirm } from "./InlineConfirm";

export type AttachmentPreview = {
  /** 그림 파일 id → inline 서명 URL(null = 서명 실패). 없는 id 는 아직 받는 중 */
  thumbs: ReadonlyMap<string, string | null>;
  onPreview: (f: FileMeta) => void;
  /** 썸네일을 못 불러왔다(서명 만료) — 한 번 다시 서명 */
  onThumbError?: (id: string) => void;
};
type ViewProps = { files: FileMeta[]; onOpen: (f: FileMeta) => void; onRemove?: (f: FileMeta) => void; busy?: string | null; /** 빼기 요청 중 — 모든 [빼기] 비활성 */ removing?: boolean; headingRef?: Ref<HTMLHeadingElement>; preview?: AttachmentPreview };

const BADGE = "shrink-0 rounded-[6px] bg-surface-2 px-[6px] py-[2px] text-[11px] font-bold text-ink-3";

/** 그림 줄의 56×56 썸네일 버튼 — 누르면 라이트박스(D13). URL 이 아직 없거나 못 불러오면 IMG 배지 */
function Thumb({ f, preview }: { f: FileMeta; preview: AttachmentPreview }) {
  const url = preview.thumbs.get(f.id);
  const [bad, setBad] = useState<ReadonlySet<string>>(new Set());
  const retried = useRef(false);
  if (!url || bad.has(url)) return <span className={BADGE}>{fileBadge(f.contentType)}</span>;
  const svg = isSvgMime(f.contentType);
  return (
    <button type="button" aria-label={`${f.name} 크게 보기`} onClick={() => preview.onPreview(f)} className={`relative h-14 w-14 shrink-0 cursor-zoom-in overflow-hidden rounded-[10px] border border-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint ${svg ? "bg-white" : "bg-surface-2"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- 서명 URL·SVG 는 next/image 최적화 대상이 아니다(스펙 D17) */}
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => {
          setBad((s) => new Set(s).add(url));
          if (!retried.current && preview.onThumbError) {
            retried.current = true;
            preview.onThumbError(f.id);
          }
        }}
        className={`h-full w-full ${svg ? "object-contain p-1" : "object-cover"}`}
      />
      {/* 눌러서 확대 힌트 — 손가락으로 쓰는 화면만, 모서리 작은 돋보기 */}
      <span aria-hidden="true" className="pointer-events-none absolute bottom-[3px] right-[3px] hidden h-[18px] w-[18px] items-center justify-center rounded-full bg-black/55 text-white pointer-coarse:flex">
        <ZoomIcon size={10} />
      </span>
    </button>
  );
}

/** 보기 상세의 "첨부 파일 n" 목록 — 0개면 아무것도 그리지 않는다 */
export function NodeAttachmentsView({ files, onOpen, onRemove, busy = null, removing = false, headingRef, preview }: ViewProps) {
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
            {preview && isImageMime(f.contentType) ? <Thumb f={f} preview={preview} /> : <span className={BADGE}>{fileBadge(f.contentType)}</span>}
            <span className="flex min-w-0 flex-[1_1_120px] flex-col">
              <span className="text-[14px] text-ink [overflow-wrap:anywhere]">{f.name}</span>
              <span className="text-[12px] text-muted">{sizeText(f.size)}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <button type="button" aria-label={`${f.name} 받기`} disabled={busy === f.id} onClick={() => onOpen(f)} className="flex h-11 items-center disabled:opacity-50">
                {/* 누르는 자리는 44px 그대로, 보이는 알약만 작게 — 첨부 줄 테두리에 닿지 않게 */}
                <span className="inline-flex h-8 items-center rounded-[16px] border border-line-3 bg-surface px-3 text-[13px] font-semibold text-ink">받기</span>
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

/** 컨테이너 — 목록은 useNodeFiles 가 마운트 뒤 한 번 받아 설명 그림과 같이 쓴다. 서버가 볼 권한을 판단하므로 받은 것만 그린다 */
export function NodeAttachments({ nodeId, files, setFiles, canRemove, toast, preview }: { nodeId: string; files: FileMeta[]; setFiles: (l: FileMeta[]) => void; canRemove: boolean; toast: (m: ToastMsg) => void; preview?: AttachmentPreview }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<FileMeta | null>(null);
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
  const status = useRef<HTMLDivElement>(null);
  // 빼기 뒤 포커스는 다시 그린 다음에 옮긴다 — 마지막 파일을 빼면 제목(h3)이 사라지므로 알림 영역으로 (body 로 떨어지지 않게)
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    (heading.current ?? status.current)?.focus({ preventScroll: true });
  }, [files, said]);
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
      refocus.current = true;
    } catch {
      toast({ text: "파일을 뺄 수 없어요", tone: "bad" });
    } finally {
      setRemoving(false);
    }
  };
  if (files.length === 0 && !said) return null;
  return (
    <div className="flex flex-col gap-2">
      <div ref={status} role="status" aria-live="polite" tabIndex={-1} className="sr-only outline-none">
        {said}
      </div>
      <NodeAttachmentsView files={files} busy={busy} removing={removing} headingRef={heading} preview={preview} onOpen={(f) => void open(f)} onRemove={canRemove ? setAsking : undefined} />
      {asking && <InlineConfirm text="이 파일을 목표에서 뺄까요? 팀원에게는 알리지 않아요" onCancel={cancel} actions={[{ label: "빼기", tone: "danger", onClick: () => void remove(asking) }]} />}
    </div>
  );
}
