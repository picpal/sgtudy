"use client";

import { Avatar } from "@/components/ui/Avatar";
import type { TaskType } from "@/data/my-study";
import { Seg, toneOfName } from "../bits";
import type { TreeNode } from "../model";
import { patchOv, type ScreenState, type Update } from "../state";

type Props = { n: TreeNode; members: string[]; S: ScreenState; update: Update };

const field = "h-[42px] rounded-[10px] border border-line-3 text-ink";

/** 그룹장 편집 미리보기 — 우측 "항목 편집" 패널. 모두 메모리 오버라이드. */
export function EditPanel({ n, members, S, update }: Props) {
  const id = n.id;
  const names = n.leaf ? n.people.map((p) => p.name) : [];
  const hasSub = n.sub > 0;
  const isGong = n.leaf && n.type === "공통";
  const removeLabel = hasSub ? (n.archived ? "보관 해제" : "보관") : "삭제";
  const path = `${n.crumb ? n.crumb + " › " : ""}${!n.leaf && n.d === 0 ? n.label : n.title} · ${n.d + 2}단계`;

  const setDate = (k: "s" | "e", v: string) => {
    if (!v) return;
    update((p) => ({ ...patchOv(p, "dates", { ...p.ov.dates, [id]: { ...(p.ov.dates[id] ?? {}), [k]: v } }), saved: "" }));
  };
  const setType = (t: TaskType) =>
    update((p) => ({
      ov: { ...p.ov, typeOv: { ...p.ov.typeOv, [id]: t }, assignOv: t === "지정" ? { ...p.ov.assignOv, [id]: p.ov.assignOv[id] ?? names } : p.ov.assignOv },
      saved: "",
    }));
  const toggleMember = (m: string) => {
    if (isGong) return;
    const next = names.includes(m) ? names.filter((x) => x !== m) : [...names, m];
    update((p) => ({ ...patchOv(p, "assignOv", { ...p.ov.assignOv, [id]: next }), saved: "" }));
  };
  const askRemove = () => {
    if (n.archived) update((p) => ({ ...patchOv(p, "archived", { ...p.ov.archived, [id]: false }), saved: "보관을 해제했어요" }));
    else update({ confirm: true, saved: "" });
  };
  const confirmYes = () => {
    if (hasSub) update((p) => ({ ...patchOv(p, "archived", { ...p.ov.archived, [id]: true }), confirm: false, saved: "보관했어요 · 제출물은 그대로 남아요" }));
    else update((p) => ({ ...patchOv(p, "removed", { ...p.ov.removed, [id]: true }), confirm: false, editSel: null, saved: "" }));
  };

  return (
    <aside aria-label="항목 편집" className="flex max-w-[340px] flex-[1_1_280px] flex-col gap-[14px] rounded-[16px] border border-line p-[18px] shadow-[0_10px_30px_rgba(27,34,48,.06)] max-[900px]:max-w-none">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-muted">{path}</span>
        <button type="button" aria-label="편집 닫기" onClick={() => update({ editSel: null, confirm: false, saved: "" })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-transparent text-ink-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
        제목
        <input type="text" value={n.title} onChange={(e) => update((p) => ({ ...patchOv(p, "titles", { ...p.ov.titles, [id]: e.target.value }), saved: "" }))} className={`${field} px-3 text-[14px] font-medium`} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
          시작일
          <input type="date" value={n.s} onChange={(e) => setDate("s", e.target.value)} className={`${field} min-w-0 px-[10px] text-[13px]`} />
        </label>
        <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
          마감일
          <input type="date" value={n.e} onChange={(e) => setDate("e", e.target.value)} className={`${field} min-w-0 px-[10px] text-[13px]`} />
        </label>
      </div>
      <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
        설명 (마크다운)
        <textarea rows={3} placeholder="목표, 참고 링크, 제출 형식 등을 적어 주세요" className="resize-y rounded-[10px] border border-line-3 px-3 py-[10px] text-[13px] font-normal text-ink" />
      </label>

      {n.leaf && (
        <>
          <div className="flex flex-col gap-[6px]">
            <span className="text-[12px] font-semibold text-ink-3">과제 유형</span>
            <Seg<TaskType> label="과제 유형" value={n.type} onChange={setType} grow options={[["공통", "공통 · 참가자 전원"], ["지정", "지정 · 일부 인원"]]} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold text-ink-3">
              담당자 <span className="font-medium text-muted">· {isGong ? "활성 참가자 전원 자동 배정" : `${names.length}명 선택됨`}</span>
            </span>
            <div className="flex flex-wrap gap-[6px]">
              {members.map((m) => {
                const on = names.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={on}
                    aria-disabled={isGong}
                    onClick={() => toggleMember(m)}
                    className={`inline-flex h-[34px] items-center gap-[6px] rounded-[17px] border py-0 pl-[6px] pr-3 text-[13px] text-ink ${on ? "border-[#3FB89C] bg-[#E8F7F2] font-semibold" : "border-line-3 bg-surface font-medium"}`}
                    style={{ opacity: isGong ? 0.7 : 1, cursor: isGong ? "default" : "pointer" }}
                  >
                    <Avatar name={m} size={22} tone={toneOfName(m)} />
                    {m}
                  </button>
                );
              })}
            </div>
            {!isGong && names.length === 0 && (
              <span role="status" className="rounded-[9px] bg-[#FDF4E1] px-[10px] py-2 text-[12px] font-semibold text-amber-text">
                담당자 미정 · 시작 전에 한 명 이상 지정해 주세요
              </span>
            )}
          </div>
        </>
      )}

      {!n.leaf && (
        <div className="rounded-[10px] bg-surface-2 px-3 py-[10px] text-[13px] leading-[1.6] text-ink-2">
          하위 항목 {n.kids.length}개 · 진척률 {n.pct}%
          <br />
          <span className="text-[12px] text-muted">하위 과제의 제출 수 ÷ 담당 건수로 자동 집계돼요</span>
        </div>
      )}

      {S.saved && (
        <div role="status" className="rounded-[10px] bg-mint-soft px-3 py-[10px] text-[13px] font-semibold text-mint-deep">
          {S.saved}
        </div>
      )}

      {S.confirm && (
        <div role="alertdialog" aria-label="확인" className="flex flex-col gap-[10px] rounded-[12px] border border-[#F0C9C4] bg-[#FFF7F6] p-3">
          <span className="text-[13px] leading-[1.6] text-ink-2">
            {hasSub ? "제출물이 있어 삭제할 수 없어요. 대신 보관하면 참가자 화면에서 숨겨지고 제출물은 그대로 남아요. 보관할까요?" : "이 항목과 하위 항목을 삭제할까요? 되돌릴 수 없어요."}
          </span>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => update({ confirm: false })} className="h-[38px] rounded-[19px] border border-line-3 bg-surface px-[14px] text-[13px]">
              취소
            </button>
            <button type="button" onClick={confirmYes} className="h-[38px] rounded-[19px] bg-warn px-[14px] text-[13px] font-semibold text-white">
              {removeLabel}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={askRemove} className="h-[42px] rounded-[21px] border border-[#EBC3BD] bg-surface px-[14px] text-[13px] font-semibold text-warn">
          {removeLabel}
        </button>
        <span className="flex-1" />
        <button type="button" onClick={() => update({ saved: "저장했어요 · 태그를 자동으로 다시 골랐어요" })} className="h-[42px] rounded-[21px] bg-navy px-5 text-[14px] font-semibold text-white">
          저장
        </button>
      </div>
    </aside>
  );
}
