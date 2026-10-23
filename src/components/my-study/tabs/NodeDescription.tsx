"use client";

import type { ToastMsg } from "@/components/ui/Toast";
import { MarkdownView } from "../MarkdownView";
import { useNodeFiles } from "../useNodeFiles";
import { NodeAttachments } from "./NodeAttachments";

/** 보기 상세의 노드 설명 + 첨부 목록 — 설명 속 ![](attachment:이름) 을 같은 노드의 첨부로 푼다 (md-images 스펙 D4·§4.1) */
export function NodeDescription({ nodeId, desc, emptyText, canRemove, toast }: { nodeId: string; desc: string; emptyText: string; canRemove: boolean; toast: (m: ToastMsg) => void }) {
  const { files, setFiles, resolver } = useNodeFiles(nodeId);
  return (
    <>
      {desc.trim() ? <MarkdownView src={desc} images={resolver} className="text-[14px] leading-[1.75]" /> : <p className="m-0 text-[13px] text-muted">{emptyText}</p>}
      <NodeAttachments nodeId={nodeId} files={files} setFiles={setFiles} canRemove={canRemove} toast={toast} />
    </>
  );
}
