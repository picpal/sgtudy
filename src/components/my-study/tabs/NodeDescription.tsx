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

/**
 * 보기 상세의 노드 설명 + 첨부 목록 — 설명 속 ![](attachment:이름) 을 같은 노드의 첨부로 푼다 (md-images 스펙 D4·§4.1).
 * 라이트박스는 여기 하나: 설명 그림·첨부 썸네일 어느 쪽에서 열어도 첨부 목록 순서의 그림들을 넘긴다(D16)
 */
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
      {desc.trim() ? <MarkdownView src={desc} images={resolver} className="text-[14px] leading-[1.75]" /> : <p className="m-0 text-[13px] text-muted">{emptyText}</p>}
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
