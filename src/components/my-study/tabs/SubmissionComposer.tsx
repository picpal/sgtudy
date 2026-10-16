"use client";

import { useId } from "react";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { SUB_LIMITS, stampKst } from "../submission";
import type { Composer } from "../useSubmissionComposer";
import { FileUploadList } from "./FileUploadList";
import { LinkListEditor } from "./LinkListEditor";

type Props = { c: Composer; editing: boolean; late: boolean; onCancel?: () => void };

/** 이 기기 임시본 안내 — [이어 쓰기] [버리기] (스펙 §2.7) */
export function DraftNotice({ at, onResume, onDrop }: { at: string; onResume: () => void; onDrop: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-[12px] border border-[#F0D79A] bg-[#FDF4E1] px-[14px] py-2 text-[13px] text-[#6B4700]">
      <span className="min-w-0 flex-[1_1_220px]">이 기기에 저장하지 않은 작성 내용이 있어요{at ? ` (${stampKst(at)})` : ""}</span>
      <button type="button" onClick={onResume} className="h-11 shrink-0 rounded-[22px] bg-navy px-4 text-[13px] font-semibold text-white">
        이어 쓰기
      </button>
      <button type="button" onClick={onDrop} className="h-11 shrink-0 rounded-[22px] border border-line-3 bg-surface px-4 text-[13px] font-semibold text-ink">
        버리기
      </button>
    </div>
  );
}

const n = (x: number) => x.toLocaleString("en-US");

/** 작성 화면 — 본문 · 링크 · 파일 · 버튼 줄 (스펙 §2.3). 서버 저장은 주 버튼만 */
export function SubmissionComposer({ c, editing, late, onCancel }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;
  const over = c.body.length > SUB_LIMITS.body;
  // 왼쪽 안내: 비활성 이유가 먼저, 없으면 수정·지각 안내
  const hint = c.blocker ?? (editing ? "마감 뒤에 고쳐도 지각 여부는 처음 제출 시각으로 정해져요" : late ? "마감이 지나 지각으로 기록돼요" : null);
  return (
    <div className="flex flex-col gap-4">
      {c.pending && <DraftNotice at={c.pending.at} onResume={c.resume} onDrop={c.dropDraft} />}
      {/* 제출하는 동안 입력 잠금 */}
      <div inert={c.busy} className="flex flex-col gap-4">
        <div className="flex flex-col gap-[6px]">
          <span id={`${id}-body`} className="text-[12px] font-semibold text-ink-3">
            제출 내용
          </span>
          <MarkdownEditor labelledBy={`${id}-body`} value={c.body} onChange={c.setBody} placeholder="정리한 내용이나 회고를 적어 주세요" minHeight={240} maxHeight="none" expandable={false} />
          {c.body.length > SUB_LIMITS.bodyWarn && (
            <span className={`self-end text-[12px] font-medium ${over ? "text-warn" : "text-muted"}`}>
              {n(c.body.length)} / {n(SUB_LIMITS.body)}자
            </span>
          )}
        </div>
        <LinkListEditor links={c.links} input={c.linkInput} onInput={c.typeLink} onAdd={c.addLink} onRemove={c.removeLink} error={c.linkError} disabled={c.busy} />
        <FileUploadList rows={c.rows} onPick={c.pick} onRemove={c.remove} onRetry={c.retry} canRetry={c.canRetry} disabled={c.busy} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line-2 pt-3">
        <span id={hintId} className={`min-w-0 flex-[1_1_220px] text-[13px] ${c.blocker ? "font-medium text-warn" : "text-muted"}`}>
          {hint}
        </span>
        <span className="flex flex-wrap justify-end gap-2">
          {editing && onCancel && (
            <button type="button" onClick={onCancel} disabled={c.busy} className="h-11 rounded-[22px] border border-line-3 bg-surface px-5 text-[14px] font-semibold text-ink disabled:opacity-50">
              취소
            </button>
          )}
          <button
            type="button"
            onClick={() => void c.submit()}
            disabled={!!c.blocker || c.busy}
            aria-describedby={c.blocker ? hintId : undefined}
            className="h-11 rounded-[22px] bg-navy px-6 text-[14px] font-semibold text-white disabled:opacity-50"
          >
            {c.busy ? "제출하는 중…" : c.label}
          </button>
        </span>
      </div>
    </div>
  );
}
