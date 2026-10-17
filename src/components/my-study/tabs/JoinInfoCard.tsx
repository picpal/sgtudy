"use client";

import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { StudyRoom } from "@/lib/api/my-study";
import { MEMBERSHIP_LABEL } from "@/lib/types";
import { toneOfName } from "../bits";
import { memberStats, overallPct, type Tree } from "../model";
import { StatusBadge } from "../StudyHeaderInfo";

type Props = { room: StudyRoom; tree: Tree; onMyTasks: () => void; goLeaf: (id: string) => void; onCancel: (kind: "leave" | "cancel") => void; busy: boolean; admin?: ReactNode };

/** 우측 aside "참가 정보" + "내 다음 마감" */
export function JoinInfoCard({ room, tree, onMyTasks, goLeaf, onCancel, busy, admin }: Props) {
  const overall = overallPct(tree.roots);
  const full = room.capCur >= room.capMax;
  const nextLeaf = room.next?.nodeId ? tree.leaves.find((l) => l.id === room.next!.nodeId) : undefined;

  return (
    <aside aria-label="참가 정보" className="flex max-w-[360px] flex-[1_1_300px] flex-col gap-[14px] @max-[788px]:grid @max-[788px]:max-w-none @max-[788px]:grid-cols-[repeat(auto-fit,minmax(280px,1fr))] @max-[788px]:items-start">
      <div className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-5 shadow-[0_10px_30px_rgba(27,34,48,.06)]">
        <div className="flex items-center justify-between">
          <StatusBadge status={room.status} draft={room.draft} />
          <span className="text-[13px] font-semibold text-ink">{room.ddayLong}</span>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-muted">참가 인원</span>
            <span className="text-[20px] font-bold">
              {room.capCur}
              <span className="text-[14px] font-medium text-muted"> / {room.capMax}명</span>
            </span>
          </div>
          <ProgressBar pct={Math.round((room.capCur / room.capMax) * 100)} height={8} fill={full ? "#B4462B" : "#12A386"} />
          {/* 최소 인원이 없는 방은 문구가 비어 있다 — 아이콘만 남기지 않는다 (V2-05) */}
          {room.minText && (
            <span className="inline-flex items-center gap-[5px] text-[12px] font-medium" style={{ color: room.minOk ? "#0D7A64" : "#8A5A00" }}>
              {room.minOk ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m5 12.5 4.5 4.5L19 7.5" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7.5v5.5" />
                  <circle cx="12" cy="16.5" r=".6" />
                </svg>
              )}
              {room.minText}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-[6px] rounded-[14px] bg-surface-2 px-[14px] py-3">
          <div className="flex justify-between text-[13px]">
            <span className="text-ink-3">전체 진척률</span>
            <b className="font-bold">{overall === null ? "시작 전" : `${overall}%`}</b>
          </div>
          <ProgressBar pct={overall ?? 0} height={6} track="#DCE8E4" />
        </div>

        <div>
          <div className="mb-2 flex justify-between text-[13px] font-semibold">
            <span>참가자</span>
            <span className="font-medium text-muted">제출 / 담당</span>
          </div>
          <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
            {room.members.map((m) => {
              const dim = !!(m.left || m.pending);
              const { done, total } = memberStats(tree.leaves, m.userId ?? "");
              const hasBar = !dim && !m.noBar;
              const pct = total ? Math.round((done / total) * 100) : 0;
              return (
                <li key={m.userId ?? m.name} className="flex items-center gap-[10px] rounded-[10px] px-2 py-[7px]" style={{ background: m.me ? "#F3F7FF" : "transparent" }}>
                  <Avatar name={m.name} size={30} tone={m.tone ?? toneOfName(m.name)} id={m.userId} pending={m.pending} className={m.left ? "bg-slate-soft! text-[#8C97A4]!" : ""} />
                  <span className="flex min-w-0 flex-1 items-center gap-[6px]">
                    <span className="whitespace-nowrap text-[14px]" style={{ fontWeight: m.me ? 700 : 500, color: dim ? "#7A8594" : "#1B2230" }}>
                      {m.name}
                    </span>
                    {m.leader && (
                      <svg width="15" height="15" viewBox="0 0 24 24" role="img" aria-label="그룹장">
                        <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="#E7A913" stroke="#B07F00" strokeWidth="1.2" strokeLinejoin="round" />
                      </svg>
                    )}
                    {m.me && <span className="rounded-[6px] bg-blue-soft px-[6px] py-px text-[11px] font-semibold text-blue-text">나</span>}
                    {m.editor && (
                      <span title="진행목표 편집 권한" className="rounded-[6px] bg-mint-soft px-[6px] py-px text-[11px] font-semibold text-mint-dark">
                        편집
                      </span>
                    )}
                    {dim && <span className="rounded-[6px] bg-slate-soft px-[6px] py-px text-[11px] font-semibold text-ink-3">{m.left ? MEMBERSHIP_LABEL.left : MEMBERSHIP_LABEL.pending}</span>}
                  </span>
                  {hasBar && <ProgressBar pct={pct} height={5} fill={pct === 100 ? "#1E9E6A" : pct === 0 ? "#D64545" : "#12A386"} className="w-14! shrink-0" />}
                  <span className="w-[34px] text-right text-[12px] font-semibold text-ink-2">{dim || m.noBar ? "–" : `${done}/${total}`}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* 상태별 문구·버튼 (Q1-12/Q2-13): 모집 기간 참가자는 /rooms 처럼 참가 취소 가능, 진행 중은 불가, 그룹장은 취소 없음 */}
        {(room.action === "joined" || room.action === "leave" || room.action === "owner") && (
          <div className="flex flex-col gap-[6px]">
            {/* 헤더 "내 과제"(/tasks, 모든 방)와 헷갈리지 않게 — 이 방 보드의 내 담당만 (Q1-12) */}
            <button type="button" onClick={onMyTasks} className="flex h-12 items-center justify-center rounded-[24px] bg-navy text-[15px] font-semibold text-white">
              보드에서 이 방 내 과제 보기
            </button>
            {room.action === "leave" && (
              <button type="button" onClick={() => onCancel("leave")} disabled={busy} className="h-11 rounded-[22px] border border-line-3 bg-surface text-[14px] font-medium text-ink disabled:opacity-60">
                참가 취소
              </button>
            )}
            <span className="text-center text-[12px] text-muted">
              {room.action === "leave" ? "모집 기간에만 참가를 취소할 수 있어요" : room.action === "owner" ? (room.draft ? "내가 만든 방이에요 · 아직 모집을 시작하지 않았어요" : "내가 만든 방이에요") : "진행 중에는 참가 취소를 할 수 없어요"}
            </span>
          </div>
        )}
        {room.action === "pending" && (
          <div className="flex flex-col gap-2">
            <div className="flex h-12 items-center justify-center gap-2 rounded-[24px] bg-amber-soft text-[15px] font-semibold text-amber-text">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              {MEMBERSHIP_LABEL.pending}
            </div>
            <button type="button" onClick={() => onCancel("cancel")} disabled={busy} className="h-11 rounded-[22px] border border-line-3 bg-surface text-[14px] font-medium text-ink disabled:opacity-60">
              신청 취소
            </button>
            <span className="text-center text-[12px] text-muted">시작일까지 승인되지 않으면 신청이 자동 만료돼요</span>
          </div>
        )}
        {room.action === "closed" && (
          <button type="button" disabled className="h-12 rounded-[24px] bg-slate-soft text-[15px] font-semibold text-muted">
            모집 종료
          </button>
        )}
      </div>

      {admin}

      {room.next && (
        <div className="flex flex-col gap-[10px] rounded-[20px] border border-[#CBEBE1] bg-[#F2FBF8] px-5 py-[18px]">
          <div className="flex items-center gap-2 text-[14px] font-bold">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0D7A64" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 21V4M4 4h12l-2 4 2 4H4" />
            </svg>
            내 다음 마감
            <span className="ml-auto rounded-[7px] bg-warn px-2 py-[2px] text-[12px] font-bold text-white">{room.next.dday}</span>
          </div>
          <div>
            <div className="text-[15px] font-semibold">{room.next.title}</div>
            <div className="mt-[3px] text-[12px] text-ink-3">{room.next.path}</div>
            <div className="mt-[2px] text-[12px] text-ink-3">{room.next.due}</div>
          </div>
          <button type="button" onClick={() => nextLeaf && goLeaf(nextLeaf.id)} className="inline-flex min-h-11 items-center gap-[6px] self-start text-[14px] font-semibold text-mint hover:text-mint-dark">
            제출하러 가기
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      )}
    </aside>
  );
}
