"use client";

import type { FileMeta, Submission } from "@/lib/api/types";
import { MarkdownView } from "../MarkdownView";
import { sizeText } from "../submission";

type Props = { s: Pick<Submission, "bodyMd" | "links" | "files">; onOpenFile: (f: FileMeta) => void };

/** 제출물 한 건 읽기 — 본문 · 링크 · 파일 (내 제출 카드 · 제출 현황 펼침 공용). 안쪽 스크롤 없이 내용만큼 자란다 */
export function SubmissionView({ s, onOpenFile }: Props) {
  const empty = s.bodyMd.trim() === "" && s.links.length === 0 && s.files.length === 0;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {s.bodyMd.trim() !== "" && <MarkdownView src={s.bodyMd} className="text-[14px] leading-[1.75] [overflow-wrap:anywhere]" />}
      {s.links.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-muted">링크</span>
          <ul className="m-0 flex list-none flex-col p-0">
            {s.links.map((u) => (
              <li key={u} className="min-w-0">
                <a href={u} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-[14px] text-mint underline underline-offset-2 [overflow-wrap:anywhere]">
                  {u}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.files.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-muted">파일</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {s.files.map((f) => (
              <li key={f.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpenFile(f)}
                  aria-label={`${f.name} 열기`}
                  className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[10px] border border-line px-3 text-left text-[14px] text-ink hover:bg-surface-2"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted">
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                    <path d="M14 3v5h5" />
                  </svg>
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{f.name}</span>
                  <span className="shrink-0 text-[12px] text-muted">{sizeText(f.size)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {empty && <p className="m-0 text-[13px] text-muted">내용이 비어 있어요</p>}
    </div>
  );
}
