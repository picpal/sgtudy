"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { ACCEPT, sizeText } from "../submission";
import type { UploadRow } from "../uploads";

type Props = {
  rows: UploadRow[];
  onPick: (files: File[]) => void;
  onRemove: (row: UploadRow) => void;
  onRetry: (row: UploadRow) => void;
  canRetry: (row: UploadRow) => boolean;
  disabled?: boolean;
  /** 위 제목 — 기본은 제출 문구 */
  label?: string;
  /** 드롭존 안내 — 기본은 제출 문구 */
  hint?: string;
  /** 노드 첨부의 그림 줄 「조각 복사」(md-images 스펙 §4.2) — 제출 첨부는 넘기지 않는다 */
  canCopy?: (row: UploadRow) => boolean;
  onCopy?: (row: UploadRow) => void;
  /** 고르기 accept — 기본은 제출 형식(노드 첨부는 SVG 를 더한 NODE_ACCEPT) */
  accept?: string;
};

const DEFAULT_HINT = "끌어다 놓아도 돼요 · PNG·JPG·GIF·WEBP·PDF·ZIP·TXT·MD · 파일당 10MB · 5개까지";

/** 첨부 — 드롭존 + [파일 고르기] · 줄마다 진행률/상태 · [취소|빼기|다시 시도] (스펙 §2.3-3) */
export function FileUploadList({ rows, onPick, onRemove, onRetry, canRetry, disabled, label = "파일 (선택)", hint = DEFAULT_HINT, canCopy, onCopy, accept = ACCEPT }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (!disabled) setOver(true);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const list = Array.from(e.dataTransfer.files);
    if (list.length) onPick(list);
  };
  return (
    <div className="flex flex-col gap-[6px]">
      <span id={`${id}-label`} className="text-[12px] font-semibold text-ink-3">
        {label}
      </span>
      {/* 드롭은 마우스 보조 — 키보드는 [파일 고르기] 로 */}
      <div
        onDragOver={onDragOver}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`flex flex-wrap items-center gap-3 rounded-[12px] border border-dashed px-4 py-3 ${over ? "border-mint bg-mint-soft" : "border-line-dash bg-surface-3"}`}
      >
        <button type="button" onClick={() => input.current?.click()} disabled={disabled} className="h-11 shrink-0 rounded-[22px] border border-line-3 bg-surface px-5 text-[14px] font-semibold text-ink disabled:opacity-50">
          파일 고르기
        </button>
        <span className="min-w-0 flex-[1_1_200px] text-[12px] text-muted">{hint}</span>
        <input
          ref={input}
          type="file"
          multiple
          accept={accept}
          aria-labelledby={`${id}-label`}
          className="hidden"
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (list.length) onPick(list);
          }}
        />
      </div>
      {rows.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {rows.map((r) => {
            const act = r.status === "uploading" ? "취소" : "빼기";
            return (
              <li key={r.key} className={`flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border px-3 py-1 ${r.status === "error" ? "border-warn bg-warn-soft" : "border-line"}`}>
                <span className="flex min-w-0 flex-[1_1_180px] flex-col">
                  <span className="text-[14px] text-ink [overflow-wrap:anywhere]">{r.name}</span>
                  <span className="text-[12px] text-muted">
                    {sizeText(r.size)}
                    {r.status === "ready" && " · 올림"}
                  </span>
                </span>
                {r.status === "uploading" && (
                  <span className="flex min-w-[140px] flex-[0_1_200px] items-center gap-2">
                    <span role="progressbar" aria-label={`${r.name} 올리는 중`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.progress} className="h-[6px] flex-1 overflow-hidden rounded-full bg-line-2">
                      <span className="block h-full rounded-full bg-mint-bar transition-[width]" style={{ width: `${r.progress}%` }} />
                    </span>
                    <span className="shrink-0 text-[12px] text-ink-2">올리는 중 {r.progress}%</span>
                  </span>
                )}
                {r.status === "error" && (
                  <span role="alert" className="text-[12px] font-medium text-warn">
                    {r.error}
                  </span>
                )}
                <span className="ml-auto flex shrink-0 gap-1">
                  {onCopy && canCopy?.(r) && (
                    <button type="button" onClick={() => onCopy(r)} aria-label={`${r.name} 조각 복사`} className="h-11 rounded-[8px] px-3 text-[13px] font-semibold text-mint hover:bg-surface-2">
                      조각 복사
                    </button>
                  )}
                  {canRetry(r) && (
                    <button type="button" onClick={() => onRetry(r)} disabled={disabled} aria-label={`${r.name} 다시 시도`} className="h-11 rounded-[8px] px-3 text-[13px] font-semibold text-mint hover:bg-surface-2 disabled:opacity-50">
                      다시 시도
                    </button>
                  )}
                  <button type="button" onClick={() => onRemove(r)} disabled={disabled} aria-label={`${r.name} ${act}`} className="h-11 rounded-[8px] px-3 text-[13px] font-semibold text-ink-3 hover:bg-surface-2 disabled:opacity-50">
                    {act}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
