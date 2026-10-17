"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import type { TaskType } from "@/data/my-study";
import { md } from "@/lib/date";
import { setLeaveGuard } from "@/lib/leaveGuard";
import { Seg } from "../bits";
import { dropFieldOv, isDirty, isPersonal, periodWarnings, removePlan, type ParentNode, type TreeMember, type TreeNode } from "../model";
import { moveNote, movedPeriod, reorderIndex, roundOf, roundOptions } from "../rounds";
import { patchOv, type Leave, type ScreenState, type Update } from "../state";
import type { CurriculumApi } from "../useCurriculumApi";
import { ChildList } from "./ChildList";
import { InlineConfirm } from "./InlineConfirm";

type Props = {
  n: TreeNode;
  parent: TreeNode | null;
  /** 경로 링크·회차 선택용 전체 노드와 회차 */
  nodes: TreeNode[];
  roots: ParentNode[];
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

const field = "h-11 rounded-[10px] border border-line-3 text-ink";
const label = "flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3";

/**
 * 그룹장 편집 — 커리큘럼 목록 자리를 통째로 쓰는 전용 편집 화면 (?item=).
 * 글(설명)이 주인공: 제목 한 줄 → 기간·유형 한 줄 → 남은 높이를 채우는 마크다운 편집기. 저장·삭제는 위쪽 고정 막대에 늘 보인다.
 * 내용 변경은 오버라이드에 모았다가 "저장" 1회(node_update), 삭제·보관은 즉시 RPC.
 */
export function EditView({ n, parent, nodes, roots, period, members, S, update, api, go, request }: Props) {
  const id = n.id;
  const view = useRef<HTMLElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const removeBtn = useRef<HTMLButtonElement>(null);
  // 과제 섹션의 순서·삭제, 회차 선택 이동이 진행 중인 항목
  const [busy, setBusy] = useState<string | null>(null);

  // 열리면 편집 화면 머리로 — 방금 추가한 항목은 제목을 선택해 바로 고쳐 쓰게, 기존 항목은 제목(머리말)에 포커스만
  useEffect(() => {
    const el = view.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
    if (S.justAdded === id && titleInput.current) {
      titleInput.current.focus({ preventScroll: true });
      titleInput.current.select();
      // 저장 전까지 "방금 만든 항목" — 저장 없이 떠나면 빈 회차를 지운다 (Q2-8, MyStudyScreen)
      update({ justAdded: null, fresh: id });
    } else heading.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 항목이 바뀔 때(key) 한 번만
  }, [id]);

  // 고정 막대 높이(저장 문구·확인 상자로 늘어난다) → 편집기 툴바가 그 아래에 붙도록 CSS 변수로
  useEffect(() => {
    const b = bar.current, el = view.current;
    if (!b || !el) return;
    const ro = new ResizeObserver(() => el.style.setProperty("--edit-bar-h", `${b.offsetHeight}px`));
    ro.observe(b);
    return () => ro.disconnect();
  }, []);

  // 저장하지 않은 수정이 있는 채로 새로고침·탭 닫기·다른 문서로 이동(전체 다시 불러오기가 되는 뒤로 가기 포함) → 브라우저 확인.
  // 앱 안 이동은 아래 "저장하지 않은 수정이 있어요" 확인이 맡는다
  const dirty = isDirty(S.ov, id);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // 옛 Safari·Chrome 은 returnValue 가 있어야 묻는다
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // 앱 안 링크(헤더 메뉴·로고·옆 목록)로 다른 화면에 가려 하면 — 미저장 수정은 아래 확인으로 보류(Q2-1),
  // 저장한 적 없는 새 회차(빈 채)는 지우고 그대로 보낸다(Q2-8 — 화면이 사라져 MyStudyScreen 의 정리가 돌지 않는다)
  const fresh = S.fresh === id && !n.leaf && n.kids.every(isPersonal);
  useEffect(() => {
    if (!dirty && !fresh) return;
    return setLeaveGuard((href) => {
      if (dirty) {
        update({ leave: { href }, confirm: false });
        return true;
      }
      api.discard(id);
      return false;
    });
  }, [dirty, fresh, id, api, update]);

  const warns = periodWarnings(n, parent, period);
  const ids = n.leaf ? n.people.map((p) => p.userId) : [];
  // 보관된 하위의 제출도 센다 — 서버는 하위 어디에든 제출이 있으면 삭제를 막는다
  const hasSub = n.subAll > 0;
  const isGong = n.leaf && n.type === "공통";
  const removeLabel = n.archived ? "보관 해제" : hasSub ? "보관" : "삭제";
  const plan = removePlan(n);
  // 내부 depth("2단계")는 보여 주지 않는다 (Q1-17) — "1주차 · 회차", "1주차 IAM·VPC › 과제". 조상은 누르면 그 편집 화면으로
  const kind = n.leaf ? "과제" : n.d === 0 ? "회차" : "묶음";
  const ancestors: TreeNode[] = [];
  for (let p = nodes.find((x) => x.id === n.parentId); p; p = nodes.find((x) => x.id === p!.parentId)) ancestors.unshift(p);
  const path = (cls: string) => (
    <nav aria-label="경로" className={`flex min-w-0 flex-wrap items-center gap-x-1 text-[13px] text-muted ${cls}`}>
      {ancestors.map((a) => (
        <span key={a.id} className="inline-flex min-w-0 items-center gap-1">
          <button type="button" disabled={a.temp} onClick={() => request({ sel: a.id })} className="inline-flex min-h-11 min-w-0 items-center rounded-[8px] px-1 text-left font-medium text-ink-2 underline-offset-2 hover:underline disabled:opacity-50 [overflow-wrap:anywhere]">
            {a.d === 0 && !a.leaf && a.label ? `${a.label} ${a.title}` : a.title}
          </button>
          <span aria-hidden="true">›</span>
        </span>
      ))}
      <span className="inline-flex min-h-11 items-center">{!n.leaf && n.d === 0 && n.label ? `${n.label} · ${kind}` : kind}</span>
    </nav>
  );

  const setDate = (k: "s" | "e", v: string) => {
    if (!v) return;
    update((p) => ({ ...patchOv(p, "dates", { ...p.ov.dates, [id]: { ...(p.ov.dates[id] ?? {}), [k]: v } }), saved: "" }));
  };
  // 개인 목표는 편집 모드에 그려지지 않는 전제 — 그래도 들어오면 유형·담당을 바꾸지 않는다(지정으로 떨어지지 않게)
  const isPersonalLeaf = n.leaf && n.personal;
  const setType = (t: TaskType) => {
    if (isPersonalLeaf) return;
    update((p) => ({
      ov: { ...p.ov, typeOv: { ...p.ov.typeOv, [id]: t }, assignOv: t === "지정" ? { ...p.ov.assignOv, [id]: p.ov.assignOv[id] ?? ids } : p.ov.assignOv },
      saved: "",
    }));
  };
  const toggleMember = (m: TreeMember) => {
    if (isGong || isPersonalLeaf) return;
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
  // "계속 편집"·Esc 로 이동 확인이 닫히면 편집 화면 머리로 포커스를 돌린다 (사라진 버튼에 남지 않게)
  const wasLeave = useRef(S.leave);
  useEffect(() => {
    if (wasLeave.current && !S.leave) heading.current?.focus({ preventScroll: true });
    wasLeave.current = S.leave;
  }, [S.leave]);
  const leaveSave = async () => {
    const to = S.leave;
    if (to && (await api.save(n, S.ov))) {
      update({ fresh: null });
      go(to);
    } else update({ leave: null });
  };
  const leaveDiscard = () => {
    const to = S.leave;
    update((p) => ({ ov: dropFieldOv(p.ov, id) }));
    // 다른 화면으로 가면 이 화면이 사라진다 — 저장한 적 없는 새 회차는 여기서 지운다(앱 안 이동은 MyStudyScreen 이 맡는다)
    if (to && "href" in to && fresh) api.discard(id);
    if (to) go(to);
  };
  const back = () => request({ sel: null });
  // Esc = 목록으로 — 미저장 수정이 있으면 묻는다(조용히 버리지 않는다). 편집기·날짜 선택기·확인 상자 안의 Esc 는 그쪽 몫
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented || S.leave || S.confirm) return;
    const t = e.target as HTMLElement;
    if (t.closest(".cm-editor") || (t instanceof HTMLInputElement && t.type === "date")) return;
    back();
  };

  return (
    <section ref={view} aria-labelledby="edit-view-title" onKeyDown={onKey} className="flex scroll-mt-0 flex-col">
      {/* 고정 막대 — 편집 화면은 문서가 스크롤된다(한 페이지 스크롤). 화면 위쪽에 붙어 저장·삭제가 잘리지 않는다 */}
      <div ref={bar} className="sticky top-0 z-[2] -mx-1 flex flex-col gap-2 border-b border-line-2 bg-surface px-1 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={back} className="inline-flex h-11 shrink-0 items-center gap-[6px] rounded-[22px] border border-line-3 bg-surface pl-3 pr-4 text-[14px] font-semibold text-ink">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
            진행목표
          </button>
          <h2 id="edit-view-title" ref={heading} tabIndex={-1} className="sr-only">
            항목 편집 · {kind} {n.title}
          </h2>
          {path("flex-1 max-sm:hidden")}
          <span className="flex-1 sm:hidden" />
          {n.temp && <span className="shrink-0 text-[12px] text-muted max-sm:hidden">서버에 만드는 중…</span>}
          {/* 상위 보관으로 함께 숨겨진 항목은 자기 보관이 아니라 해제할 대상이 없다 → 버튼을 숨긴다 */}
          {/* 확인 상자가 떠 있는 동안은 숨긴다 — 빨간 "삭제" 가 두 개 보이지 않게 (Q2-22) */}
          {!n.archivedByParent && !S.confirm && (
            <button ref={removeBtn} type="button" disabled={n.temp} onClick={askRemove} className="h-11 shrink-0 rounded-[22px] border border-[#EBC3BD] bg-surface px-4 text-[14px] font-semibold text-warn disabled:opacity-50">
              {removeLabel}
            </button>
          )}
          <button type="button" disabled={n.temp} onClick={() => void api.save(n, S.ov).then((ok) => ok && update({ fresh: null }))} className="h-11 shrink-0 rounded-[22px] bg-navy px-6 text-[14px] font-semibold text-white disabled:opacity-50">
            저장
          </button>
        </div>
        {S.saved && (
          <div role="status" className="rounded-[10px] bg-mint-soft px-3 py-2 text-[13px] font-semibold text-mint-deep">
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
            text={plan.kind === "none" ? plan.reason : plan.text}
            onCancel={cancelConfirm}
            actions={[{ label: removeLabel, onClick: confirmYes, tone: "danger" }]}
          />
        )}
      </div>

      <div className="flex flex-col gap-4 pt-5">
        {/* 좁은 화면은 막대에 경로를 줄 자리가 없다 → 제목 위에 */}
        <div className="-mb-2 -mt-2 flex flex-wrap items-center sm:hidden">
          {path("")}
          {n.temp && <span className="text-[13px] text-muted">&nbsp;· 서버에 만드는 중…</span>}
        </div>
        <label className={label}>
          제목
          <input ref={titleInput} type="text" value={n.title} disabled={n.temp} onChange={(e) => update((p) => ({ ...patchOv(p, "titles", { ...p.ov.titles, [id]: e.target.value }), saved: "" }))} className={`${field} h-[52px] px-[14px] text-[18px] font-bold disabled:bg-surface-2`} />
        </label>

        {/* 기간·유형은 한 줄에 — 좁으면 접어 내린다. 회차·묶음의 하위 집계는 같은 줄 끝의 보조 글 */}
        <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
          <label className={`${label} min-w-0 flex-[0_1_180px] max-sm:flex-[1_1_140px]`}>
            시작일
            <input type="date" value={n.s} disabled={n.temp} onChange={(e) => setDate("s", e.target.value)} className={`${field} min-w-0 px-[10px] text-[14px]`} />
          </label>
          <label className={`${label} min-w-0 flex-[0_1_180px] max-sm:flex-[1_1_140px]`}>
            마감일
            <input type="date" value={n.e} disabled={n.temp} onChange={(e) => setDate("e", e.target.value)} className={`${field} min-w-0 px-[10px] text-[14px]`} />
          </label>
          {n.leaf && !n.personal && (
            <div className={`${label} min-w-0 flex-[0_1_300px] max-sm:flex-[1_1_100%]`}>
              <span>과제 유형</span>
              <div className="[&_button]:h-11">
                <Seg<TaskType> label="과제 유형" value={n.type} onChange={setType} grow options={[["공통", "공통 · 참가자 전원"], ["지정", "지정 · 일부 인원"]]} />
              </div>
            </div>
          )}
          {n.leaf &&
            (() => {
              const cur = roundOf(nodes, n);
              const opts = roundOptions(roots);
              return (
                <label className={`${label} min-w-0 flex-[0_1_300px] max-sm:flex-[1_1_100%]`}>
                  회차
                  <select
                    value={cur?.id ?? ""}
                    disabled={n.temp || n.archived || dirty || busy !== null}
                    onChange={(e) => {
                      const to = roots.find((r) => r.id === e.target.value);
                      if (!to || !cur || (to.id === cur.id && n.parentId === cur.id)) return;
                      const period = to.id === cur.id ? null : movedPeriod(n, cur, to);
                      setBusy(id);
                      void api
                        .move(id, to.id, undefined, period ? [{ id, ...period }] : [], period ? `${to.label}로 옮겼어요 · 기간 ${md(period.s)} – ${md(period.e)}` : `${to.label}로 옮겼어요`)
                        .then((ok) => ok && update({ saved: moveNote(n, period, false) }))
                        .finally(() => setBusy(null));
                    }}
                    className={`${field} min-w-0 bg-surface px-[10px] text-[14px]`}
                  >
                    {!cur && <option value="">회차 없음</option>}
                    {opts.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.text}
                      </option>
                    ))}
                  </select>
                  <span className="text-[12px] font-medium text-muted">
                    {dirty ? "저장한 뒤 옮길 수 있어요" : `${n.parentId !== cur?.id ? `지금: ${n.crumb} · ` : ""}다른 회차로 옮기면 그 회차 기간에 맞춰져요 · 제출이 있으면 기간은 그대로예요`}
                  </span>
                </label>
              );
            })()}
          {!n.leaf && (
            <p className="m-0 min-w-0 flex-[1_1_220px] pb-[2px] text-[13px] leading-[1.55] text-ink-2 @min-[560px]:text-right">
              과제 {n.kids.filter((k) => !isPersonal(k)).length}개 · 진척률 {n.pct}%
              <br />
              <span className="text-[12px] text-muted">과제의 제출 수 ÷ 담당 건수로 자동 집계돼요</span>
            </p>
          )}
        </div>

        {/* E4: 기간 경고 — 저장은 막지 않는다 (Q1-10/Q2-21) */}
        {warns.length > 0 && (
          <div role="status" className="flex flex-col gap-[2px] rounded-[9px] bg-[#FDF4E1] px-[10px] py-2 text-[12px] font-semibold text-amber-text">
            {warns.map((w) => (
              <span key={w}>{w} · 저장은 할 수 있어요</span>
            ))}
          </div>
        )}

        {/* 회차(·묶음): 과제 섹션 — 순서·삭제·추가는 즉시 RPC (제목 등 미저장 수정과 무관) */}
        {!n.leaf && (
          <ChildList
            // 편집 모드엔 개인 목표를 그리지 않는다 — 보이는 목록은 팀 자식만, 서버 index(reorderIndex)는 원래 kids 로
            parent={{ ...n, kids: n.kids.filter((k) => !isPersonal(k)) }}
            onOpen={(cid) => request({ sel: cid })}
            edit={{
              busy,
              canAdd: !n.archived && !n.temp,
              onAdd: (t) => api.create(n.id, { title: t, open: false }),
              onRemove: (cid) => {
                const k = n.kids.find((x) => x.id === cid);
                if (k && removePlan(k).kind === "archive") void api.archive(cid, true, "list");
                else void api.remove(cid, "child");
              },
              onMove: (cid, dir) => {
                const to = reorderIndex(n, cid, dir);
                if (to === null) return;
                setBusy(cid);
                void api.move(cid, n.id, to).finally(() => setBusy(null));
              },
            }}
          />
        )}

        {n.leaf && (
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
                    className={`inline-flex h-11 items-center gap-[6px] rounded-[22px] border py-0 pl-[8px] pr-[14px] text-[13px] text-ink ${on ? "border-[#3FB89C] bg-[#E8F7F2] font-semibold" : "border-line-3 bg-surface font-medium"}`}
                    style={{ opacity: isGong ? 0.7 : 1, cursor: isGong ? "default" : "pointer" }}
                  >
                    <Avatar name={m.name} size={24} tone={m.tone} />
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
        )}

        <div className="flex flex-col gap-[6px]">
          <span id={`desc-label-${id}`} className="text-[12px] font-semibold text-ink-3">
            설명
          </span>
          {/* 남은 화면 높이를 채우고(최소 420) 내용만큼 자란다 — 편집 면 안쪽 스크롤 없음(maxHeight none). 툴바는 고정 막대 아래에 붙는다.
              "크게 쓰기" 도 둔다 — 방 만들기 상세 설명·운영 규칙 편집기와 같게(Q2-6), 390 에선 큰 창이 더 넓다 */}
          <MarkdownEditor
            labelledBy={`desc-label-${id}`}
            value={n.desc}
            onChange={(v) => update((p) => ({ ...patchOv(p, "descs", { ...p.ov.descs, [id]: v }), saved: "" }))}
            placeholder="목표, 참고 링크, 제출 형식 등을 적어 주세요"
            minHeight={n.leaf ? "max(420px, calc(100dvh - 520px))" : "420px"}
            maxHeight="none"
            stickyToolbar="var(--edit-bar-h, 68px)"
          />
        </div>
      </div>
    </section>
  );
}
