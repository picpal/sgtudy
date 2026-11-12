"use client";

import { useMemo } from "react";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import type { ToastMsg } from "@/components/ui/Toast";
import { fileUrl } from "@/lib/api/submission";
import { isImageMime, isSvgMime } from "@/lib/files/imageMime";
import { MarkdownView } from "../MarkdownView";
import { sizeText } from "../submission";
import { useNodeFiles } from "../useNodeFiles";
import { NodeAttachments } from "./NodeAttachments";

/** 라이트박스는 여기 하나 — 설명 그림·첨부 썸네일 어느 쪽에서 열어도 첨부 목록 순서로 넘긴다 */
export function NodeDescription({ nodeId, desc, emptyText, canRemove, toast }: { nodeId: string; desc: string; emptyText: string; canRemove: boolean; toast: (m: ToastMsg) => void }) {
  const { files, setFiles, resolver, urls, refresh, openId, setOpenId } = useNodeFiles(nodeId);
  const images = useMemo(() => files.filter((f) => isImageMime(f.contentType)), [files]);
  const at = openId ? images.findIndex((f) => f.id === openId) : -1;
  const download = async (id: string) => {
    const f = images.find((x) => x.id === id);
    if (!f) return;
    try {
      window.location.assign(await fileUrl(f));
    } catch {
      toast({ text: "파일을 열 수 없어요", tone: "bad" });
    }
  };
  return (
    <>
      {desc.trim() ? <div data-ask-ai="node"><MarkdownView src={desc} images={resolver} doc className="text-[14px] leading-[1.75]" /></div> : <p className="m-0 text-[13px] text-muted">{emptyText}</p>}
      <NodeAttachments nodeId={nodeId} files={files} setFiles={setFiles} canRemove={canRemove} toast={toast} preview={{ thumbs: urls, onPreview: (f) => setOpenId(f.id), onThumbError: refresh }} />
      {at >= 0 && (
        <ImageLightbox
          items={images.map((f) => ({ id: f.id, name: f.name, sizeLabel: sizeText(f.size), url: urls.get(f.id), svg: isSvgMime(f.contentType) }))}
          index={at}
          onIndex={(i) => setOpenId(images[i]?.id ?? null)}
          onClose={() => setOpenId(null)}
          onDownload={(id) => void download(id)}
          onRefresh={refresh}
        />
      )}
    </>
  );
}
