"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { InfoTip } from "@/components/ui/InfoTip";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { setCurriculumEditor } from "@/lib/api/my-study";
import type { RoomMemberDto } from "@/lib/api/types";
import { editorErrorText, editorRows } from "../editors";
import { LeaveAdmin } from "./LeaveAdmin";
import { personalStats, type Tree } from "../model";

export const EDITOR_TIP = "켜 두면 그 팀원도 회차·과제를 추가하고 고칠 수 있어요. 기본은 그룹장만 편집해요.";

type Props = {
  slug: string;
  members: RoomMemberDto[];
  meId: string;
  toast: (m: ToastMsg) => void;
  /** 개인 목표 열 — 저장된 트리(Tree.personal = 보관 제외)와 이번 회차(thisRoundId — /tasks 와 같은 규칙, 모집·진행 중이 아니면 null) */
  tree: Tree;
  roundId: string | null;
  /** "팀원 개인 목표 보기 →" — 진행목표 보기 + 팀원 목표 칩 켜기 */
  onShowOthers: () => void;
  /** 진행중·미보관 방만 — 탈퇴 요청 처리·내보내기 (시나리오 QA D3) */
  leave?: { today: string; leaderDoesTasks: boolean; leaveRequestCount: number };
};

/** 그룹장 전용 "멤버 관리" — 참가 중인 팀원에게 커리큘럼 편집 권한을 주고 거둔다 (기본은 그룹장만 편집) */
export function MemberAdminCard({ slug, members, meId, toast, tree, roundId, onShowOthers, leave }: Props) {
  const router = useRouter();
  // 낙관적 값 — 응답이 실패하면 지운다(원래 값으로). 성공하면 서버 값과 같으므로 그대로 둔다
  const [ov, setOv] = useState<Record<string, boolean>>({});
  // 처리 중인 줄 — 같은 줄을 연달아 눌러 요청이 겹치지 않게 (ref 는 즉시 막고, state 는 버튼을 비활성으로 그린다)
  const busyRef = useRef(new Set<string>());
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const rows = editorRows(members, ov);
  const others = rows.filter((r) => !r.leader);
  // 개인 목표 · 이번 회차 완료/전체 (팀 수치와 따로)
  const statOf = (userId: string) => {
    if (roundId === null) return { text: "–", label: "지금 진행 중인 회차가 없어요" };
    const { done, total } = personalStats(tree.personal, userId, roundId);
    return total === 0 ? { text: "없음", label: "이번 회차 개인 목표 없음" } : { text: `${done}/${total}`, label: `이번 회차 개인 목표 ${total}개 중 ${done}개 완료` };
  };

  const toggle = async (userId: string, name: string, next: boolean) => {
    if (busyRef.current.has(userId)) return;
    busyRef.current.add(userId);
    setBusy((p) => ({ ...p, [userId]: true }));
    setOv((p) => ({ ...p, [userId]: next }));
    try {
      await setCurriculumEditor(slug, userId, next);
      toast({ text: next ? `${name} 님이 진행목표를 편집할 수 있어요` : `${name} 님의 편집 권한을 거뒀어요`, tone: "ok" });
      router.refresh(); // 참가자 목록의 "편집" 표시
    } catch (e) {
      setOv(({ [userId]: _omit, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
      toast({ text: editorErrorText(toApiError(e).code, name), tone: "bad" });
    } finally {
      busyRef.current.delete(userId);
      setBusy(({ [userId]: _done, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
    }
  };

  return (
    <section aria-labelledby="member-admin-title" className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-5 shadow-[0_10px_30px_rgba(27,34,48,.06)]">
      <div className="flex items-center gap-[2px]">
        <h3 id="member-admin-title" className="m-0 text-[14px] font-bold">
          멤버 관리
        </h3>
        <InfoTip label="진행목표 편집 권한 설명" text={EDITOR_TIP} />
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {rows.map((r) => {
          const st = statOf(r.userId);
          return (
          <li key={r.userId} data-member={r.userId} className="flex min-h-11 items-center gap-[10px] border-t border-line py-1 first:border-t-0">
            <Avatar name={r.name} size={28} tone={r.tone} id={r.userId} />
            {/* 이름 아래 개인 목표 열 — 좁은 옆 카드에서 이름이 잘리지 않게 두 줄로 */}
            <span className="flex min-w-0 flex-1 flex-col items-start gap-[2px]">
              <span className="max-w-full truncate text-[14px]" style={{ fontWeight: r.userId === meId ? 700 : 500 }}>
                {r.name}
              </span>
              <span title={`개인 목표 · ${st.label}`} className="inline-flex items-center gap-1 rounded-[6px] bg-personal-field px-[6px] text-[11px] leading-[18px] text-personal-ink">
                <span aria-hidden="true">개인 목표</span>
                <span className="sr-only">{st.label}</span>
                <b aria-hidden="true" data-personal-stat className={st.text === "없음" || st.text === "–" ? "font-medium" : "font-bold"}>
                  {st.text}
                </b>
              </span>
            </span>
            {r.leader ? (
              <span className="text-[12px] font-medium text-muted">그룹장 · 항상 편집 가능</span>
            ) : (
              <button
                type="button"
                role="switch"
                aria-checked={r.on}
                aria-label={`${r.name} 진행목표 편집`}
                disabled={!!busy[r.userId]}
                onClick={() => void toggle(r.userId, r.name, !r.on)}
                className="group inline-flex min-h-11 items-center gap-2 rounded-[10px] px-1 text-[12px] font-medium text-ink-2 disabled:opacity-60"
              >
                진행목표 편집
                <span aria-hidden="true" className={`relative inline-block h-6 w-10 shrink-0 rounded-full transition-colors ${r.on ? "bg-mint" : "bg-faint"}`}>
                  <span className={`absolute top-[3px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(27,34,48,.25)] transition-[left] ${r.on ? "left-[19px]" : "left-[3px]"}`} />
                </span>
              </button>
            )}
          </li>
          );
        })}
      </ul>
      {others.length === 0 && <p className="m-0 text-[12px] text-muted">아직 참가 중인 팀원이 없어요</p>}
      {others.length > 0 && (
        <button type="button" onClick={onShowOthers} className="inline-flex min-h-11 items-center gap-[6px] self-start rounded-[10px] px-1 text-[13px] font-semibold text-mint hover:text-mint-dark">
          팀원 개인 목표 보기
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      )}
      {leave && <LeaveAdmin slug={slug} members={members} toast={toast} {...leave} />}
    </section>
  );
}
