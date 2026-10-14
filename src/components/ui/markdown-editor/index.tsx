"use client";

import dynamic from "next/dynamic";
import type { MarkdownEditorProps } from "./MarkdownEditor";

/** 로딩 중 자리 — 에디터와 같은 외곽·높이라 들어올 때 화면이 튀지 않는다 */
function EditorSkeleton() {
  return (
    <div aria-busy="true" aria-label="에디터 불러오는 중" className="overflow-hidden rounded-[10px] border border-line-3 bg-surface">
      <div className="h-10 border-b border-line-2 bg-surface-3" />
      <div className="h-[140px]" />
    </div>
  );
}

/**
 * 마크다운 에디터(지연 로드) — CodeMirror 청크는 이 컴포넌트가 실제로 그려질 때만 받는다.
 * 편집 화면이 아닌 페이지는 비용을 내지 않는다. 브라우저 전용(contenteditable)이라 SSR 하지 않는다.
 */
export const MarkdownEditor = dynamic<MarkdownEditorProps>(() => import("./MarkdownEditor").then((m) => m.MarkdownEditor), {
  ssr: false,
  loading: EditorSkeleton,
});
