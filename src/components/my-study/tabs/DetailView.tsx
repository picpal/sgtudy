"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { setLeaveGuard } from "@/lib/leaveGuard";
import { useRefocusOnClose } from "@/lib/useRefocusOnClose";
import { Avatar } from "@/components/ui/Avatar";
import type { ToastMsg } from "@/components/ui/Toast";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { md, weekdayKo } from "@/lib/date";
import { useMe } from "@/lib/me";
import { useToday } from "@/lib/today";
import { useStickyOffset } from "@/lib/useStickyOffset";
import { MarkdownView } from "../MarkdownView";
import { ArchivedBadge, TypeBadge } from "../bits";
import { roundStatus, type LeafNode, type ParentNode, type TreeNode } from "../model";
import { archiveOthersText, cardSync, isDone, ownerCode, ownerOf, personalActions, removeText, roundWarning, statusColor, statusText, type CardSkip, type PersonalActions } from "../personal";
import type { RoomStatus } from "../submission";
import type { CurriculumApi } from "../useCurriculumApi";
import { ChildList } from "./ChildList";
import { InlineConfirm } from "./InlineConfirm";
import { LeafBody } from "./LeafBody";
import { PersonalForm } from "./PersonalForm";
import { PersonalSection } from "./PersonalSection";

type Props = {
  n: TreeNode;
  nodes: TreeNode[];
  canEdit: boolean;
  onOpen: (id: string) => void;
  onBack: () => void;
  onEdit: () => void;
  slug: string;
  roomStatus: RoomStatus;
  /** 진입 포커스 — "submission" 이면 제목 대신 제출 영역 (SubmissionSection 이 맡는다) */
  focus: "submission" | null;
  onFocused: () => void;
  onSubmitted: () => void;
  toast: (m: ToastMsg) => void;
  viewerPending: boolean;
  isLeader: boolean;
  quietNotAssigned: boolean;
  /* 개인 목표 (Task 9) — 편집 폼의 회차 선택·방 기간, 추가 자격, RPC */
  roots: ParentNode[];
  period: { start: string; end: string };
  personal?: { canAdd: boolean; perRound: number };
  api: CurriculumApi;
};

const NOT_ACTIVE = "스터디가 진행 중일 때 완료할 수 있어요";

/** 개인 목표 ⋯ 메뉴 — 보관(해제) · 삭제. Esc·바깥 클릭으로 닫히고 버튼으로 포커스가 돌아온다. 위/아래 화살표로 항목 이동 */
function MoreMenu({ n, a, onArchive, onRemove }: { n: LeafNode; a: PersonalActions; onArchive: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const away = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  // Tab 으로 메뉴 밖(⋯ 버튼 포함 바깥)으로 포커스가 나가면 닫는다 — 포커스는 옮겨 간 자리에 둔다
  const onBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null;
    if (!to || menu.current?.contains(to) || btn.current?.contains(to)) return;
    setOpen(false);
  };
  const pick = (f: () => void) => () => {
    setOpen(false);
    f();
  };
  const item = "flex min-h-11 w-full flex-wrap items-center gap-x-[10px] rounded-[10px] px-3 py-2 text-left text-[14px] font-medium text-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent";
  return (
    <div className="relative shrink-0">
      <button
        ref={btn}
        type="button"
        aria-label="더 보기"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-11 w-11 items-center justify-center rounded-[12px] border bg-surface text-ink-3 ${open ? "border-ink" : "border-line-3"}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label="개인 목표 메뉴" onKeyDown={onKey} onBlur={onBlur} className="absolute right-0 top-[52px] z-[3] flex w-[270px] max-w-[calc(100vw-32px)] flex-col rounded-[14px] border border-line bg-surface p-[6px] shadow-[0_12px_32px_rgba(27,34,48,.14)]">
          {a.archive && (
            <button type="button" role="menuitem" onClick={pick(onArchive)} className={item}>
              {n.archived ? "보관 해제" : "보관"}
            </button>
          )}
          {(a.remove || a.removeOff) && (
            <button type="button" role="menuitem" disabled={!a.remove} onClick={pick(onRemove)} className={`${item} ${a.remove ? "text-warn" : ""}`}>
              삭제
              {a.removeOff && <span className="w-full text-[12px] font-normal text-muted">{a.removeOff}</span>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 보기 모드 상세 — 목록 자리를 쓰는 읽기 전용 화면 (?tab=curriculum&item=). 회차는 기간·진척·설명·과제 목록, 과제는 설명·담당자별 상태 */
export function DetailView({ n, nodes, canEdit, onOpen, onBack, onEdit, slug, roomStatus, focus, onFocused, onSubmitted, toast, viewerPending, isLeader, quietNotAssigned, roots, period, personal, api }: Props) {
  const today = useToday();
  const meId = useMe()?.id ?? null;
  // 위 고정 막대 높이 → 제출·개인 목표 편집기 툴바가 그 밑에 붙는다 (Q1-10)
  const stickyBar = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  useStickyOffset(stickyBar, sectionRef);
  // 개인 목표 리프 — 머리 버튼(완료·편집·⋯)·소유자 표시·경고·편집 폼
  const pn = n.leaf && n.personal ? n : null;
  const acts = pn ? personalActions(pn, meId, isLeader, roomStatus, !!personal?.canAdd) : null;
  const isOwner = !!pn && meId !== null && pn.ownerId === meId;
  const code = pn ? ownerCode(pn) : null;
  const done = !!code && isDone(code);
  const [editing, setEditing] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const onDirtyChange = useCallback((d: boolean) => setFormDirty(d), []);
  const [unsaved, setUnsaved] = useState<(() => void) | null>(null);
  // 개인 목표 편집 폼에 저장 안 한 수정 → 헤더 메뉴·⋯ 메뉴 등 앱 안 링크도 아래 "저장하지 않은 수정이 있어요" 로 보류 (최종 리뷰 Minor 8)
  const router = useRouter();
  useEffect(() => {
    if (!(editing && formDirty)) return;
    return setLeaveGuard((href) => {
      setUnsaved(() => () => router.push(href));
      return true;
    });
  }, [editing, formDirty, router]);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  // 소유자 코드가 체크·토스트 "되돌리기" 등 제출 카드 밖에서 바뀌면 제출 카드(task_get)를 새로 받는다 — LeafBody 를 다시 마운트.
  // 카드에서 처음 제출해 바뀐 것(onSubmitted → refresh)은 카드가 이미 최신이라 다시 마운트하지 않는다 — 저장 직전 코드·노드를 기억(personal.cardSync)
  const [subTick, setSubTick] = useState(0);
  const [seenCode, setSeenCode] = useState(code);
  const [cardSkip, setCardSkip] = useState<CardSkip>(null);
  const sync = cardSync(seenCode, code, cardSkip, n);
  if (code !== seenCode || sync.skip !== cardSkip) {
    setSeenCode(code);
    setCardSkip(sync.skip);
    if (sync.remount) setSubTick((t) => t + 1);
  }
  const heading = useRef<HTMLHeadingElement>(null);
  // 진입 포커스가 있으면 제목 포커스는 건너뛴다 — 처음 열릴 때 한 번만 본다
  const focusAtOpen = useRef(focus);
  useEffect(() => {
    if (focusAtOpen.current) return;
    heading.current?.focus({ preventScroll: true });
    const el = heading.current?.closest("section");
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  }, [n.id]);
  // 경로 조각: 회차(·묶음) — 누르면 그 상세로
  const ancestors: TreeNode[] = [];
  for (let p = nodes.find((x) => x.id === n.parentId); p; p = nodes.find((x) => x.id === p!.parentId)) ancestors.unshift(p);
  const kind = pn ? "개인 목표" : n.leaf ? "과제" : n.d === 0 ? "회차" : "묶음";
  // 파일을 올리는 중이면 나가기 전에 묻는다 (스펙 §2.8) — 탭 전환·브라우저 뒤로 가기는 막지 않는다
  const [uploading, setUploading] = useState(false);
  const [leave, setLeave] = useState<(() => void) | null>(null);
  const guard = (go: () => void) => {
    if (editing && formDirty) setUnsaved(() => go);
    else if (uploading) setLeave(() => go);
    else go();
  };
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented || unsaved || leave || asking) return;
    const t = e.target as HTMLElement;
    // 편집 폼: 설명 편집기·날짜 선택기 안의 Esc 는 그쪽 몫, 나머지는 [← 진행목표] 와 같다(미저장이면 묻는다)
    if (editing) {
      if (t.closest(".cm-editor") || (t instanceof HTMLInputElement && t.type === "date")) return;
    } else if (t.closest("input, textarea, [contenteditable=true]")) return; // 제출 작성 칸 안의 Esc 는 나가기가 아니다
    guard(onBack);
  };
  // 편집 폼을 닫으면 제목으로 — 제목이 다시 그려진 뒤(effect, 빠른 추가와 같은 훅)
  const refocusForm = useRefocusOnClose(editing);
  const closeForm = () => {
    refocusForm(() => heading.current);
    setEditing(false);
    setFormDirty(false);
  };
  const complete = async () => {
    if (!pn || busy) return;
    setBusy(true);
    await api.completePersonal(pn.id, !done);
    setBusy(false);
  };
  // 그룹장이 남의 목표를 보관하면 한 번 묻는다(소유자에게 알림이 간다 — 시나리오 QA #7). 내 목표·보관 해제는 바로
  const [askArchive, setAskArchive] = useState(false);
  const archive = () => {
    if (!pn) return;
    if (!isOwner && !pn.archived) return setAskArchive(true);
    void api.archivePersonal(pn.id, !pn.archived);
  };
  const remove = async () => {
    if (!pn) return;
    setAsking(false);
    if (await api.removePersonal(pn.id)) onBack();
  };
  const round = pn ? (nodes.find((x) => x.id === pn.parentId) ?? null) : null;
  const warn = pn && isOwner ? roundWarning(pn, round, today) : null;
  const owner = pn && !isOwner ? ownerOf(pn) : null;
  return (
    <section ref={sectionRef} aria-labelledby={pn && editing ? `pf-${pn.id}` : "detail-title"} onKeyDown={onKey} className="flex flex-col">
      <div ref={stickyBar} className="sticky top-0 z-[2] -mx-1 flex flex-wrap items-center gap-2 border-b border-line-2 bg-surface px-1 py-3">
        <button type="button" onClick={() => guard(onBack)} className="inline-flex h-11 shrink-0 items-center gap-[6px] rounded-[22px] border border-line-3 bg-surface pl-3 pr-4 text-[14px] font-semibold text-ink">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          진행목표
        </button>
        {/* 개인 목표는 머리 버튼이 2~3개 — 좁으면 경로가 세로로 찌그러지지 않게 버튼 줄을 아래로 내린다 */}
        <nav aria-label="경로" className={`flex min-w-0 flex-wrap items-center gap-x-1 text-[13px] text-muted ${pn ? "flex-[1_1_14rem]" : "flex-1"}`}>
          {ancestors.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1">
              <button type="button" onClick={() => guard(() => onOpen(a.id))} className="inline-flex min-h-11 items-center rounded-[8px] px-1 font-medium text-ink-2 underline-offset-2 hover:underline">
                {a.d === 0 && !a.leaf && a.label ? `${a.label} ${a.title}` : a.title}
              </button>
              <span aria-hidden="true">›</span>
            </span>
          ))}
          <span>{kind}</span>
        </nav>
        {pn && acts && !editing && (
          <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
            {isOwner && !pn.archived && (acts.edit || acts.complete) && (
              <button
                type="button"
                aria-pressed={done}
                aria-busy={busy || undefined}
                disabled={!acts.complete || busy}
                title={acts.complete ? undefined : NOT_ACTIVE}
                aria-describedby={acts.complete ? undefined : "complete-why"}
                onClick={() => void complete()}
                className={`inline-flex h-11 items-center gap-[6px] rounded-[22px] px-4 text-[14px] font-semibold disabled:opacity-50 ${done ? "border border-line-3 bg-surface text-ink" : "bg-[#1E9E6A] text-white"}`}
              >
                {!done && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 12.5 4.5 4.5L19 7.5" />
                  </svg>
                )}
                {done ? "완료 취소" : "완료로 표시"}
              </button>
            )}
            {/* 비활성 이유는 버튼 밖 — 안에 두면 접근 가능한 이름에 섞여 describedby 와 두 번 읽힌다 */}
            {isOwner && !pn.archived && acts.edit && !acts.complete && (
              <span id="complete-why" className="sr-only">
                {NOT_ACTIVE}
              </span>
            )}
            {acts.edit && (
              <button type="button" onClick={() => guard(() => setEditing(true))} className="h-11 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-semibold text-ink">
                편집
              </button>
            )}
            {(acts.archive || acts.remove || acts.removeOff) && <MoreMenu n={pn} a={acts} onArchive={archive} onRemove={() => setAsking(true)} />}
          </div>
        )}
        {canEdit && !pn && (
          <button type="button" onClick={() => guard(onEdit)} className="h-11 shrink-0 rounded-[22px] bg-navy px-5 text-[14px] font-semibold text-white">
            편집
          </button>
        )}
      </div>

      {leave && (
        <div className="pt-3">
          <InlineConfirm
            text="파일을 올리는 중이에요 · 나가면 올리기가 취소돼요"
            cancelLabel="머무르기"
            onCancel={() => setLeave(null)}
            actions={[
              {
                label: "나가기",
                tone: "danger",
                onClick: () => {
                  const go = leave;
                  setLeave(null);
                  go();
                },
              },
            ]}
          />
        </div>
      )}

      {unsaved && (
        <div className="pt-3">
          <InlineConfirm
            text="저장하지 않은 수정이 있어요"
            cancelLabel="계속 고치기"
            onCancel={() => setUnsaved(null)}
            actions={[
              {
                label: "버리기",
                tone: "danger",
                onClick: () => {
                  const go = unsaved;
                  setUnsaved(null);
                  setEditing(false);
                  setFormDirty(false);
                  go();
                },
              },
            ]}
          />
        </div>
      )}

      {askArchive && pn && (
        <div className="pt-3">
          <InlineConfirm
            text={archiveOthersText(owner?.name ?? "팀원")}
            onCancel={() => setAskArchive(false)}
            actions={[
              {
                label: "보관",
                tone: "danger",
                onClick: () => {
                  setAskArchive(false);
                  void api.archivePersonal(pn.id, true);
                },
              },
            ]}
          />
        </div>
      )}

      {asking && pn && (
        <div className="pt-3">
          <InlineConfirm text={removeText(pn)} onCancel={() => setAsking(false)} actions={[{ label: "삭제", tone: "danger", onClick: () => void remove() }]} />
        </div>
      )}

      {pn && editing ? (
        <div className="pt-5">
          <PersonalForm n={pn} roots={roots} period={period} api={api} onDone={closeForm} onDirtyChange={onDirtyChange} />
        </div>
      ) : (
        <div className="flex flex-col gap-4 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            {!n.leaf && n.d === 0 && n.label && <span className="shrink-0 rounded-[7px] bg-navy px-2 py-[3px] text-[12px] font-bold text-white">{n.label}</span>}
            {n.leaf && <TypeBadge type={n.type} />}
            <h2 id="detail-title" ref={heading} tabIndex={-1} className="m-0 min-w-0 text-[20px] font-bold text-ink outline-none [overflow-wrap:anywhere]">
              {n.title}
            </h2>
            {n.archived && <ArchivedBadge left={n.leaf && n.ownerLeft} />}
          </div>
          <p className="m-0 flex flex-wrap items-center gap-x-[6px] text-[13px] text-ink-2">
            {/* 남의 개인 목표만 소유자(아바타 20px + 이름) — 내 것에는 표시 없음 (결정 5) */}
            {owner && (
              <>
                <Avatar name={owner.name} size={20} tone={owner.tone} />
                <span className="font-medium text-ink">{owner.name}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span>
              {md(n.s)}({weekdayKo(n.s)}) – {md(n.e)}({weekdayKo(n.e)}) ·{" "}
              {pn && code ? (
                <span className={statusColor(code) ? "font-semibold" : ""} style={{ color: statusColor(code) }}>
                  {statusText(pn, today)}
                </span>
              ) : (
                roundStatus(n, today)
              )}
            </span>
            {n.by && !pn && (
              <>
                <span aria-hidden="true">·</span>
                <span data-created-by>{n.by} 님이 추가</span>
              </>
            )}
          </p>
          {acts?.note && (
            <p role="note" className="m-0 rounded-[12px] bg-surface-2 px-[14px] py-[10px] text-[13px] text-ink-3">
              {acts.note}
            </p>
          )}
          {warn && (
            <p role="status" className="m-0 rounded-[9px] bg-[#FDF4E1] px-[10px] py-2 text-[12px] font-semibold text-amber-text">
              {warn}
            </p>
          )}
          {n.leaf ? (
            <LeafBody
              key={`${n.id}:${subTick}`}
              n={n}
              slug={slug}
              roomStatus={roomStatus}
              focus={focus}
              onFocused={onFocused}
              onSubmitted={() => {
                if (pn && !done && code) setCardSkip({ from: code, at: n }); // 처음 제출이면 코드가 바뀐다 — 이 코드에서 바뀐 한 번만 다시 마운트를 건너뛴다
                onSubmitted();
              }}
              toast={toast}
              viewerPending={viewerPending}
              onUploadingChange={setUploading}
              isLeader={isLeader}
              quietNotAssigned={quietNotAssigned}
            />
          ) : (
            <>
              <div className="flex items-center gap-3">
                <ProgressBar pct={n.pct} height={8} fill={n.pct === 100 ? "#1E9E6A" : "#12A386"} className="max-w-[320px] flex-1" />
                <span className="text-[13px] text-ink-2">
                  <b className="font-bold text-ink">{n.pct}%</b> · 제출 {n.sub}/{n.asg}
                </span>
              </div>
              {n.desc.trim() ? <MarkdownView src={n.desc} className="text-[14px] leading-[1.75]" /> : <p className="m-0 text-[13px] text-muted">{kind} 설명이 아직 없어요</p>}
              <ChildList parent={n} onOpen={onOpen} />
              {n.d === 0 && <PersonalSection round={n} meId={meId} isLeader={isLeader} roomStatus={roomStatus} personal={personal} api={api} onOpen={(id) => guard(() => onOpen(id))} />}
            </>
          )}
        </div>
      )}
    </section>
  );
}
