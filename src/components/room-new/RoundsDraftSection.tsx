"use client";

import { useState } from "react";
import type { RoundsResponse } from "@/lib/ai/rounds/schema";

/*
 * 미리보기(직접 입력 모드) 의 「회차 초안」 섹션(2단계 D30·D33). 회차마다 포함/제외 체크 + [다시 생성].
 * 글은 텍스트 노드로만 보인다(마크다운 해석 없음) — 적용 뒤 진행목표 화면에서 마크다운으로 렌더된다.
 * 데스크톱은 펼친 채, 모바일은 접힌 채 시작한다
 */

const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/** 포함한 회차 기준 개수 — 섹션 요약·버튼 라벨·모집 가능 여부가 같은 셈을 쓴다 */
export function includedStats(data: RoundsResponse, excluded: ReadonlySet<number>) {
  const inc = data.rounds.filter((r) => !excluded.has(r.index));
  const tasks = inc.reduce((n, r) => n + r.tasks.length, 0);
  const exams = inc.filter((r) => r.exam).length;
  return { rounds: inc.length, tasks, exams, leaves: tasks + exams };
}

export function RoundsDraftSection({ data, excluded, onToggle, stale, busy, error, onRegenerate }: {
  data: RoundsResponse;
  excluded: ReadonlySet<number>;
  onToggle: (index: number) => void;
  /** 폼에서 기간을 바꿨다 — 이 초안은 적용하지 않는다 */
  stale: boolean;
  busy: boolean;
  error: string | null;
  onRegenerate: () => void;
}) {
  // 회차 초안은 인터뷰 뒤 클라이언트에서만 생긴다(SSR 마크업에 없음) — 첫 렌더에 바로 잰다
  const [open, setOpen] = useState(() => typeof matchMedia === "function" && matchMedia("(min-width: 1024px)").matches);
  const s = includedStats(data, excluded);
  const summary = stale ? "회차 초안" : `회차 초안 ${s.rounds}개 · 과제 ${s.tasks}개${s.exams ? ` · 시험 ${s.exams}개` : ""}`;

  return (
    <section aria-label="회차 초안" className="flex flex-col gap-2 rounded-[14px] border border-line px-4 py-2">
      {stale ? (
        <p className="m-0 flex min-h-11 items-center text-[15px] font-semibold">{summary}</p>
      ) : (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[15px] font-semibold [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-90">›</span>
            {summary}
          </summary>
          <ol className="m-0 flex list-none flex-col gap-1 p-0 pb-2">
            {data.rounds.map((r) => (
              <li key={r.index} className="flex flex-col">
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px]">
                  <input type="checkbox" checked={!excluded.has(r.index)} onChange={() => onToggle(r.index)} disabled={busy} className="size-5 shrink-0 accent-mint" />
                  <span className="shrink-0 text-[13px] text-muted">{r.label} · {md(r.startDate)}~{md(r.endDate)}</span>
                  <span className={`min-w-0 break-words font-semibold ${excluded.has(r.index) ? "text-muted line-through" : "text-ink"}`}>{r.title}</span>
                </label>
                {(r.goalMd || r.tasks.length > 0 || r.exam) && (
                  <details className="group/row ml-8">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[13px] text-ink-2 [&::-webkit-details-marker]:hidden">
                      <span aria-hidden="true" className="text-muted transition-transform group-open/row:rotate-90">›</span>
                      목표·과제 보기
                    </summary>
                    <div className="flex flex-col gap-1 pb-2 text-[13px] text-ink-2">
                      {r.goalMd && <p className="m-0 whitespace-pre-wrap break-words">{r.goalMd}</p>}
                      <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                        {r.tasks.map((t, i) => <li key={i} className="break-words">{t}</li>)}
                        {r.exam && <li>{r.label} 확인 시험 <span className="text-muted">(빈 시험 초안)</span></li>}
                      </ul>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2">
        {stale && <p className="m-0 text-[13px] text-warn">기간이 바뀌어 회차 초안을 다시 잡아야 해요</p>}
        {!stale && data.padded > 0 && <p className="m-0 text-[13px] text-muted">일부 회차는 기본 제목이에요</p>}
        {!stale && s.rounds === 0 && <p className="m-0 text-[13px] text-muted">회차 없이 방만 만들어요</p>}
        {!stale && s.rounds > 0 && excluded.size > 0 && <p className="m-0 text-[13px] text-muted">뺀 회차 자리는 비워 둬요</p>}
        {busy && <p aria-busy="true" className="m-0 text-[13px] text-muted">회차를 다시 잡는 중… 10~40초 걸려요</p>}
        {error && !busy && <p role="alert" className="m-0 text-[13px] text-warn">{error}</p>}
        <button type="button" onClick={onRegenerate} disabled={busy} className="ml-auto h-11 rounded-[22px] border border-line-3 px-4 text-[14px] font-semibold text-ink-2 disabled:text-muted">
          다시 생성
        </button>
      </div>
    </section>
  );
}
