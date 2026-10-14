"use client";

import { useEffect, useRef } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import type { TaskType } from "@/data/my-study";
import { Seg } from "../bits";
import { dropFieldOv, periodWarnings, type TreeMember, type TreeNode } from "../model";
import { patchOv, type Leave, type ScreenState, type Update } from "../state";
import type { CurriculumApi } from "../useCurriculumApi";
import { InlineConfirm } from "./InlineConfirm";

type Props = {
  n: TreeNode;
  parent: TreeNode | null;
  period: { start: string; end: string };
  members: TreeMember[];
  S: ScreenState;
  update: Update;
  api: CurriculumApi;
  /** 보류했던 목적지로 이동 (Q2-05) */
  go: (to: Leave) => void;
  /** 미저장 수정이 있으면 먼저 묻고 이동 */
  request: (to: Leave) => void;
};

const field = "h-[42px] rounded-[10px] border border-line-3 text-ink";

/** 그룹장 편집 — 우측 "항목 편집" 패널. 내용 변경은 오버라이드에 모았다가 "저장" 1회(node_update), 삭제·보관은 즉시 RPC. */
export function EditPanel({ n, parent, period, members, S, update, api, go, request }: Props) {
  const id = n.id;
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const removeBtn = useRef<HTMLButtonElement>(null);
  // 넓은 화면은 sticky 로 트리 옆에 붙어 있다. 좁은 화면(패널이 트리 아래로 내려감)에서는 고른 항목의 편집기로 스크롤 + 제목 포커스 (Q2-06/Q2-07/Q3-04)
  useEffect(() => {
    const el = panel.current;
    if (!el || getComputedStyle(el).position === "sticky") return;
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    heading.current?.focus({ preventScroll: true });
  }, [id]);
  const warns = periodWarnings(n, parent, period);
  const ids = n.leaf ? n.people.map((p) => p.userId) : [];
  // 보관된 하위의 제출도 센다 — 서버는 하위 어디에든 제출이 있으면 삭제를 막는다
  const hasSub = n.subAll > 0;
  const isGong = n.leaf && n.type === "공통";
  const removeLabel = n.archived ? "보관 해제" : hasSub ? "보관" : "삭제";
  // 내부 depth("2단계")는 보여 주지 않는다 (Q1-17)
  const path = `${n.crumb ? n.crumb + " › " : ""}${!n.leaf && n.d === 0 ? n.label : n.title}`;

  const setDate = (k: "s" | "e", v: string) => {
    if (!v) return;
    update((p) => ({ ...patchOv(p, "dates", { ...p.ov.dates, [id]: { ...(p.ov.dates[id] ?? {}), [k]: v } }), saved: "" }));
  };
  const setType = (t: TaskType) =>
    update((p) => ({
      ov: { ...p.ov, typeOv: { ...p.ov.typeOv, [id]: t }, assignOv: t === "지정" ? { ...p.ov.assignOv, [id]: p.ov.assignOv[id] ?? ids } : p.ov.assignOv },
      saved: "",
    }));
  const toggleMember = (m: TreeMember) => {
    if (isGong) return;
    const next = ids.includes(m.userId) ? ids.filter((x) => x !== m.userId) : [...ids, m.userId];
    update((p) => ({ ...patchOv(p, "assignOv", { ...p.ov.assignOv, [id]: next }), saved: "" }));
  };
  const askRemove = () => {
    if (n.archived) void api.archive(id, false);
    else update({ confirm: true, leave: null, saved: "" });
  };
  const confirmYes = () => {
    if (hasSub) void api.archive(id, true);
    else void api.remove(id);
  };
  const cancelConfirm = () => update({ confirm: false });
  // 확인 상자가 닫히면(취소·Esc) 포커스를 원래 버튼으로 돌린다
  const wasConfirm = useRef(S.confirm);
  useEffect(() => {
    if (wasConfirm.current && !S.confirm) removeBtn.current?.focus();
    wasConfirm.current = S.confirm;
  }, [S.confirm]);
  const leaveSave = async () => {
    const to = S.leave;
    if (to && (await api.save(n, S.ov))) go(to);
    else update({ leave: null });
  };
  const leaveDiscard = () => {
    const to = S.leave;
    update((p) => ({ ov: dropFieldOv(p.ov, id) }));
    if (to) go(to);
  };

  return (
    <aside
      ref={panel}
      aria-labelledby="edit-panel-title"
      className={
        "flex scroll-mt-4 flex-col gap-[14px] rounded-[16px] border border-line bg-surface p-[18px] shadow-[0_10px_30px_rgba(27,34,48,.06)] " +
        // 트리 옆에서는 설명을 쓸 만한 폭을 먼저 잡고(360 → 420 → 460) 나머지를 트리에 준다. 화면보다 길면 패널 안에서 스크롤
        // (main 위쪽 96px + sticky top 16px + 아래 여백 32px = 144px)
        "@min-[760px]:sticky @min-[760px]:top-4 @min-[760px]:max-h-[calc(100dvh-144px)] @min-[760px]:flex-[0_0_360px] @min-[760px]:self-start @min-[760px]:overflow-y-auto @min-[840px]:basis-[420px] @min-[960px]:basis-[460px] thin-scroll"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="edit-panel-title" ref={heading} tabIndex={-1} className="m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] font-normal text-muted outline-none" title={path}>
          <span className="sr-only">항목 편집 · </span>
          {path}
        </h3>
        <button type="button" aria-label="편집 닫기" onClick={() => request({ sel: null })} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-transparent text-ink-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      <label className="flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
        제목
        <input type="text" value={n.title} onChange={(e) => update((p) => ({ ...patchOv(p, "titles", { ...p.ov.titles, [id]: e.target.value }), saved: "" }))} className={`${field} px-3 text-[14px] font-medium`} />
      </label>
      {/* 날짜 입력은 달력 아이콘까지 ≈150px 가 필요하다 — 패널이 좁으면(트리 옆 1280 등) 한 줄씩 쌓는다 (V2-03) */}
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-0 flex-[1_1_150px] flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
          시작일
          <input type="date" value={n.s} onChange={(e) => setDate("s", e.target.value)} className={`${field} min-w-0 px-[10px] text-[13px]`} />
        </label>
        <label className="flex min-w-0 flex-[1_1_150px] flex-col gap-[6px] text-[12px] font-semibold text-ink-3">
          마감일
          <input type="date" value={n.e} onChange={(e) => setDate("e", e.target.value)} className={`${field} min-w-0 px-[10px] text-[13px]`} />
        </label>
      </div>
      {/* E4: 기간 경고 — 저장은 막지 않는다 (Q1-10/Q2-21) */}
      {warns.length > 0 && (
        <div role="status" className="flex flex-col gap-[2px] rounded-[9px] bg-[#FDF4E1] px-[10px] py-2 text-[12px] font-semibold text-amber-text">
          {warns.map((w) => (
            <span key={w}>{w} · 저장은 할 수 있어요</span>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-[6px]">
        <span id={`desc-label-${id}`} className="text-[12px] font-semibold text-ink-3">
          설명
        </span>
        <MarkdownEditor
          labelledBy={`desc-label-${id}`}
          value={n.desc}
          onChange={(v) => update((p) => ({ ...patchOv(p, "descs", { ...p.ov.descs, [id]: v }), saved: "" }))}
          placeholder="목표, 참고 링크, 제출 형식 등을 적어 주세요"
          minHeight={260}
          maxHeight={440}
        />
      </div>

      {n.leaf && (
        <>
          <div className="flex flex-col gap-[6px]">
            <span className="text-[12px] font-semibold text-ink-3">과제 유형</span>
            <Seg<TaskType> label="과제 유형" value={n.type} onChange={setType} grow options={[["공통", "공통 · 참가자 전원"], ["지정", "지정 · 일부 인원"]]} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold text-ink-3">
              담당자 <span className="font-medium text-muted">· {isGong ? "활성 참가자 전원 자동 배정" : `${ids.length}명 선택됨`}</span>
            </span>
            <div className="flex flex-wrap gap-[6px]">
              {members.map((m) => {
                const on = ids.includes(m.userId);
                return (
                  <button
                    key={m.userId}
                    type="button"
                    aria-pressed={on}
                    aria-disabled={isGong}
                    onClick={() => toggleMember(m)}
                    className={`inline-flex h-[34px] items-center gap-[6px] rounded-[17px] border py-0 pl-[6px] pr-3 text-[13px] text-ink ${on ? "border-[#3FB89C] bg-[#E8F7F2] font-semibold" : "border-line-3 bg-surface font-medium"}`}
                    style={{ opacity: isGong ? 0.7 : 1, cursor: isGong ? "default" : "pointer" }}
                  >
                    <Avatar name={m.name} size={22} tone={m.tone} />
                    {m.name}
                  </button>
                );
              })}
            </div>
            {!isGong && ids.length === 0 && (
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

      {S.leave && (
        <InlineConfirm
          text="저장하지 않은 수정이 있어요. 저장할까요?"
          cancelLabel="계속 편집"
          onCancel={() => update({ leave: null })}
          actions={[
            { label: "버리기", onClick: leaveDiscard },
            { label: "저장하고 이동", onClick: () => void leaveSave(), tone: "primary" },
          ]}
        />
      )}

      {S.confirm && (
        <InlineConfirm
          text={hasSub ? "제출물이 있어 삭제할 수 없어요. 대신 보관하면 참가자 화면에서 숨겨지고 제출물은 그대로 남아요. 보관할까요?" : "이 항목과 하위 항목을 삭제할까요? 되돌릴 수 없어요."}
          onCancel={cancelConfirm}
          actions={[{ label: removeLabel, onClick: confirmYes, tone: "danger" }]}
        />
      )}

      <div className="flex items-center gap-2">
        {/* 상위 보관으로 함께 숨겨진 항목은 자기 보관이 아니라 해제할 대상이 없다 → 버튼을 숨긴다 */}
        {/* 확인 상자가 떠 있는 동안 아래 버튼은 숨긴다 — 빨간 "삭제" 가 두 개 보이지 않게 (Q2-22) */}
        {!n.archivedByParent && !S.confirm && (
          <button ref={removeBtn} type="button" disabled={n.temp} onClick={askRemove} className="h-[42px] rounded-[21px] border border-[#EBC3BD] bg-surface px-[14px] text-[13px] font-semibold text-warn disabled:opacity-50">
            {removeLabel}
          </button>
        )}
        <span className="flex-1" />
        {n.temp && <span className="text-[12px] text-muted">서버에 만드는 중…</span>}
        <button type="button" disabled={n.temp} onClick={() => void api.save(n, S.ov)} className="h-[42px] rounded-[21px] bg-navy px-5 text-[14px] font-semibold text-white disabled:opacity-50">
          저장
        </button>
      </div>
    </aside>
  );
}
