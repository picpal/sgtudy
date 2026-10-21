"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { MoreMenu, type MoreMenuItem } from "@/components/ui/MoreMenu";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { createNotice, deleteNotice, fetchNotices, markNoticesRead, NOTICE_LIMITS, noticeErrorText, updateNotice, validateNotice, type NoticeFieldErrors } from "@/lib/api/notices";
import { relativeTime } from "@/lib/api/notifications";
import type { Notice, NoticeList, NoticePatch } from "@/lib/api/types";
import { setLeaveGuard } from "@/lib/leaveGuard";
import { MarkdownView } from "../MarkdownView";
import { useRoomArchived } from "../roomArchived";
import { tabPatch, type Leave, type ScreenState, type Update } from "../state";
import { InlineConfirm } from "./InlineConfirm";

/** leader: 그룹장 · member: 참가 중(ACTIVE) · left: 이탈(INACTIVE, 읽기만) · pending: 승인 대기(볼 수 없음, D10) */
export type NoticeViewer = "leader" | "member" | "left" | "pending";

type Draft = { title: string; bodyMd: string; popup: boolean; pinned: boolean; renotify: boolean };
const EMPTY: Draft = { title: "", bodyMd: "", popup: false, pinned: false, renotify: false };
const draftOf = (n: Notice): Draft => ({ title: n.title, bodyMd: n.bodyMd, popup: n.popup, pinned: n.pinned, renotify: false });
const sameDraft = (a: Draft, b: Draft) => a.title === b.title && a.bodyMd === b.bodyMd && a.popup === b.popup && a.pinned === b.pinned && a.renotify === b.renotify;

const LIMIT_TEXT = {
  total: "공지는 100개까지예요",
  pinned: "고정은 3개까지예요",
  popup: "팝업 공지는 5개까지예요 · 오래된 공지의 팝업을 꺼 주세요",
} as const;

const field = "h-11 w-full min-w-0 rounded-[10px] border border-line-3 bg-surface px-3 text-[14px] text-ink";
const label = "flex min-w-0 flex-col gap-[6px] text-[12px] font-semibold text-ink-3";

type Props = {
  slug: string;
  S: ScreenState;
  update: Update;
  viewer: NoticeViewer;
  /** 종료된 방 — 서버 canWrite 가 거짓인 이유 문구용 (보관은 useRoomArchived) */
  ended: boolean;
  /** 안 읽은 공지가 남았나 — 탭 점(D9) */
  onUnread: (unread: boolean) => void;
  toast: (m: ToastMsg) => void;
  /** 바뀌면 목록을 다시 받는다 — 같은 화면에서 공지 알림을 다시 눌렀을 때 */
  reload?: number;
};

/** 공지 탭 (스펙 §6.3) — 고정 → 최신순 목록, 펼쳐 읽기(읽음 처리), 그룹장은 탭 위 인라인 폼으로 쓰기·고치기 */
export function NoticeTab({ slug, S, update, viewer, ended, onUnread, toast, reload = 0 }: Props) {
  const archived = useRoomArchived();
  const router = useRouter();
  const [list, setList] = useState<NoticeList | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const pending = viewer === "pending";

  useEffect(() => {
    if (pending) return;
    let live = true;
    fetchNotices(slug)
      .then((l) => {
        if (!live) return;
        setList(l);
        setLoadErr(null);
        onUnread(l.items.some((n) => !n.read));
      })
      .catch((e) => live && setLoadErr(noticeErrorText(toApiError(e))));
    return () => {
      live = false;
    };
  }, [slug, pending, tick, reload, onUnread]);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  // 펼침 = 읽음 (D7) — 안 읽은 공지만 한 번 부른다. 실패해도 읽기는 그대로(다음에 다시 시도)
  const reading = useRef(new Set<string>());
  const toggle = (n: Notice) => {
    const open = S.noticeOpen === n.id ? null : n.id;
    update({ noticeOpen: open });
    if (!open || n.read || reading.current.has(n.id)) return;
    reading.current.add(n.id);
    markNoticesRead(slug, [n.id], [n.rev])
      .then((r) => {
        setList((l) => l && { ...l, items: l.items.map((x) => (x.id === n.id ? { ...x, read: true } : x)) });
        onUnread(r.unread);
      })
      .catch(() => {})
      .finally(() => reading.current.delete(n.id));
  };

  // ---- 작성·수정 폼 ----
  const editing = S.noticeEdit;
  const isNew = editing?.id === "new";
  // 고치는 공지는 폼을 열 때 찍어 둔다 — 목록을 다시 받아도(다른 기기 고정·삭제) 비교 기준·작성/수정 분기가 바뀌지 않게
  const [snap, setSnap] = useState<Notice | null>(null);
  const target = editing && !isNew ? snap : null;
  // 고치던 공지가 그새 삭제됐다 — 새 공지로 올리지 않는다
  const gone = !!editing && !isNew && !!list && (!snap || !list.items.some((n) => n.id === editing.id));
  const base = target ? draftOf(target) : EMPTY;
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [fieldErr, setFieldErr] = useState<NoticeFieldErrors | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const writeBtn = useRef<HTMLButtonElement>(null);
  const formKey = editing?.id ?? null;
  // 폼을 열면(새 공지·다른 공지) 그 공지 값으로 채운다 — 고치기는 목록이 온 뒤에 찍는다
  const [seenKey, setSeenKey] = useState<string | null>(null);
  if (formKey !== seenKey && (isNew || !editing || list)) {
    const t = editing && !isNew ? (list?.items.find((n) => n.id === editing.id) ?? null) : null;
    setSeenKey(formKey);
    setSnap(t);
    setDraft(t ? draftOf(t) : EMPTY);
    setFieldErr(null);
  }
  useEffect(() => {
    if (formKey) titleRef.current?.focus();
  }, [formKey]);
  const dirty = !!editing && !sameDraft(draft, base);
  useEffect(() => {
    if (S.noticeUnsaved !== dirty) update({ noticeUnsaved: dirty });
  }, [dirty, S.noticeUnsaved, update]);
  // 헤더 메뉴·옆 목록 링크(GuardedLink)도 아래 "저장하지 않은 수정이 있어요" 로 보류, 새로고침·닫기는 브라우저 확인
  const [heldHref, setHeldHref] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    const off = setLeaveGuard((href) => {
      setHeldHref(href);
      return true;
    });
    return () => {
      window.removeEventListener("beforeunload", warn);
      off();
    };
  }, [dirty]);
  // 브라우저 뒤로 가기(같은 앱 안 이동이라 beforeunload 가 없다) — 처음 고치기 시작하면 같은 주소 기록을 하나 쌓아 두고,
  // 뒤로 가기로 그 기록이 빠지면 다시 쌓고 묻는다(진행목표 편집 화면과 같은 방식). 폼을 닫을 때는 back 으로 걷은 뒤 닫는다
  const guardEntry = useRef(false);
  const afterBack = useRef<(() => void) | null>(null);
  const [backHeld, setBackHeld] = useState(false);
  useEffect(() => {
    if (!dirty || guardEntry.current) return;
    window.history.pushState(null, "", window.location.href);
    guardEntry.current = true;
  }, [dirty]);
  useEffect(() => {
    const onPop = () => {
      if (!guardEntry.current) return;
      const then = afterBack.current;
      if (then) {
        // 폼을 닫으며 걷은 기록 — 이제 닫는다
        afterBack.current = null;
        guardEntry.current = false;
        then();
        return;
      }
      window.history.pushState(null, "", window.location.href);
      setBackHeld(true);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  /** 폼을 닫는 길(취소·저장·버리고 이동) — 쌓아 둔 기록이 있으면 걷고 나서 then */
  const leaveForm = (then: () => void) => {
    if (!guardEntry.current) return then();
    afterBack.current = then;
    window.history.back();
  };
  const closeForm = () => {
    update({ noticeEdit: null, noticeUnsaved: false });
    writeBtn.current?.focus({ preventScroll: true });
  };
  // 버리기 — 보류한 탭·주소로 가거나, 뒤로 가기였으면 쌓은 기록 아래(그 전 화면)로
  const discardAndGo = () => {
    if (backHeld) {
      setBackHeld(false);
      guardEntry.current = false;
      update({ noticeEdit: null, noticeUnsaved: false, leave: null });
      window.history.go(-2);
      return;
    }
    const to: Leave | null = S.leave;
    const href = heldHref;
    setHeldHref(null);
    leaveForm(() => {
      // 폼을 깨끗하게 본 tabPatch — 보류 없이 옮기며 폼을 닫는다
      update((p) => ({ noticeEdit: null, noticeUnsaved: false, leave: null, ...(to && "tab" in to ? tabPatch({ ...p, noticeUnsaved: false }, to.tab, false) : {}) }));
      if (href) router.push(href);
    });
  };
  const asking = (!!S.leave && S.noticeUnsaved) || heldHref !== null || backHeld;

  const counts = list?.counts;
  const limits = list?.limits;
  const atLimit = (k: "total" | "pinned" | "popup") => !!counts && !!limits && counts[k] >= limits[k];
  // 이미 켜진 공지를 고칠 때는 상한과 무관 — 켜는 순간만 막는다(서버와 같은 규칙)
  const popupLocked = !base.popup && atLimit("popup");
  const pinLocked = !base.pinned && atLimit("pinned");

  const save = async () => {
    if (saving || !editing || gone) return;
    const bad = validateNotice(draft);
    if (bad) {
      setFieldErr(bad);
      (bad.title ? titleRef.current : null)?.focus();
      return;
    }
    setFieldErr(null);
    setSaving(true);
    try {
      if (isNew) {
        const n = await createNotice(slug, { title: draft.title.trim(), bodyMd: draft.bodyMd, popup: draft.popup, pinned: draft.pinned });
        toast({ text: n.popup ? "공지를 올렸어요 · 멤버가 들어오면 팝업으로 보여요" : "공지를 올렸어요", tone: "ok" });
        leaveForm(() => update({ noticeEdit: null, noticeUnsaved: false, noticeOpen: n.id }));
      } else if (target) {
        // 폼을 연 때와 견주어 내가 바꾼 것만 — 그사이 다른 곳에서 한 고정·팝업 변경을 되돌리지 않는다
        const patch: NoticePatch = {};
        if (draft.title !== base.title) patch.title = draft.title.trim();
        if (draft.bodyMd !== base.bodyMd) patch.bodyMd = draft.bodyMd;
        if (draft.popup !== base.popup) patch.popup = draft.popup;
        if (draft.pinned !== base.pinned) patch.pinned = draft.pinned;
        if (draft.popup && draft.renotify) patch.renotify = true;
        if (Object.keys(patch).length > 0) await updateNotice(slug, target.id, patch);
        toast({ text: patch.renotify ? "공지를 고쳤어요 · 멤버가 들어오면 다시 팝업으로 보여요" : "공지를 고쳤어요", tone: "ok" });
        leaveForm(() => update({ noticeEdit: null, noticeUnsaved: false, noticeOpen: target.id }));
      }
      refetch();
    } catch (e) {
      const err = toApiError(e);
      const f = err.details?.field;
      if (err.code === "VALIDATION_FAILED" && (f === "title" || f === "bodyMd")) setFieldErr({ [f]: err.message });
      else toast({ text: noticeErrorText(err), tone: "bad" });
      // 상한·권한·상태는 그새 바뀌었을 수 있다 — 목록(개수·canWrite)을 다시 받는다
      if (err.code !== "VALIDATION_FAILED") refetch();
    } finally {
      setSaving(false);
    }
  };

  // ---- 행 메뉴(그룹장) ----
  const [delId, setDelId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const quick = async (n: Notice, patch: NoticePatch, ok: string) => {
    try {
      await updateNotice(slug, n.id, patch);
      toast({ text: ok, tone: "ok" });
    } catch (e) {
      toast({ text: noticeErrorText(toApiError(e)), tone: "bad" });
    }
    refetch();
  };
  const menuOf = (n: Notice): MoreMenuItem[] => [
    { key: "edit", label: "수정", onSelect: () => update({ noticeEdit: { id: n.id } }) },
    {
      key: "pin",
      label: n.pinned ? "고정 해제" : "상단에 고정",
      onSelect: () => (!n.pinned && atLimit("pinned") ? toast({ text: LIMIT_TEXT.pinned, tone: "bad" }) : void quick(n, { pinned: !n.pinned }, n.pinned ? "고정을 풀었어요" : "상단에 고정했어요")),
    },
    ...(n.popup ? [{ key: "popup", label: "팝업 끄기", onSelect: () => void quick(n, { popup: false }, "팝업을 껐어요 · 목록에는 남아요") }] : []),
    { key: "del", label: "삭제", danger: true, onSelect: () => setDelId(n.id) },
  ];
  const remove = async () => {
    if (!delId || busy) return;
    setBusy(true);
    try {
      await deleteNotice(slug, delId);
      toast({ text: "공지를 삭제했어요", tone: "ok" });
      if (S.noticeOpen === delId) update({ noticeOpen: null });
    } catch (e) {
      toast({ text: noticeErrorText(toApiError(e)), tone: "bad" });
    } finally {
      setBusy(false);
      setDelId(null);
      refetch();
    }
  };

  const ids = useId();
  const canWrite = !!list?.canWrite;
  const now = new Date();

  if (pending)
    return (
      <div className="mt-6">
        <h2 className="m-0 text-[18px] font-bold">공지사항</h2>
        <p className="mt-3 mb-0 rounded-[12px] bg-surface-2 px-[14px] py-3 text-[13px] text-muted">참가가 승인되면 공지를 볼 수 있어요</p>
      </div>
    );

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[18px] font-bold">공지사항</h2>
        {canWrite && !editing && (
          <button
            ref={writeBtn}
            type="button"
            disabled={atLimit("total")}
            aria-describedby={atLimit("total") ? `${ids}-total` : undefined}
            onClick={() => update({ noticeEdit: { id: "new" } })}
            className="h-11 rounded-[22px] bg-navy px-5 text-[14px] font-semibold text-white disabled:opacity-50"
          >
            공지 쓰기
          </button>
        )}
      </div>
      {canWrite && !editing && atLimit("total") && (
        <p id={`${ids}-total`} className="-mt-2 m-0 text-[12px] font-medium text-amber-text">
          {LIMIT_TEXT.total} · 오래된 공지를 지우면 새로 쓸 수 있어요
        </p>
      )}
      {viewer === "leader" && list && !canWrite && (
        <p role="note" className="m-0 rounded-[12px] bg-surface-2 px-[14px] py-3 text-[13px] text-muted">
          {archived ? "보관된 스터디라" : ended ? "종료된 스터디라" : "지금은"} 공지를 쓰거나 고칠 수 없어요 · 지난 공지는 그대로 읽을 수 있어요
        </p>
      )}

      {editing && (
        <form
          aria-labelledby={`${ids}-form`}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="flex flex-col gap-4 rounded-[16px] border border-line-2 p-5 max-sm:p-4"
        >
          <h3 id={`${ids}-form`} className="m-0 text-[16px] font-bold">
            {isNew ? "새 공지" : "공지 고치기"}
          </h3>
          {gone && (
            <p role="alert" className="m-0 rounded-[10px] bg-[#FFF7F6] px-3 py-[10px] text-[13px] font-medium text-warn">
              이 공지는 삭제됐어요 · 고친 내용은 저장할 수 없어요. 필요하면 내용을 복사해 새 공지로 올려 주세요
            </p>
          )}
          <label className={label}>
            <span>
              제목 <span className="font-normal text-muted">{draft.title.length}/{NOTICE_LIMITS.title}</span>
            </span>
            <input
              ref={titleRef}
              type="text"
              value={draft.title}
              maxLength={NOTICE_LIMITS.title}
              aria-invalid={!!fieldErr?.title || undefined}
              aria-describedby={fieldErr?.title ? `${ids}-terr` : undefined}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="예: 이번 주 모임은 화요일로 옮겨요"
              className={`${field} font-semibold`}
            />
            {fieldErr?.title && (
              <span id={`${ids}-terr`} className="text-[12px] font-medium text-warn">
                {fieldErr.title}
              </span>
            )}
          </label>
          <div className="flex flex-col gap-[6px]">
            <span id={`${ids}-body`} className="text-[12px] font-semibold text-ink-3">
              본문
            </span>
            <MarkdownEditor labelledBy={`${ids}-body`} value={draft.bodyMd} onChange={(v) => setDraft((d) => ({ ...d, bodyMd: v }))} placeholder="모두가 알아야 할 규칙·일정을 적어 주세요" minHeight={200} maxHeight="none" expandable={false} />
            {fieldErr?.bodyMd && (
              <span role="alert" className="text-[12px] font-medium text-warn">
                {fieldErr.bodyMd}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <Check
              checked={draft.popup}
              disabled={popupLocked}
              onChange={(v) => setDraft((d) => ({ ...d, popup: v, renotify: v && d.renotify }))}
              text="입장 시 팝업으로 알리기"
              hint={popupLocked ? LIMIT_TEXT.popup : "멤버가 방에 들어올 때 한 번 띄워요. 확인하면 다시 뜨지 않아요"}
              warn={popupLocked}
            />
            {!isNew && draft.popup && (
              <Check checked={draft.renotify} onChange={(v) => setDraft((d) => ({ ...d, renotify: v }))} text="수정 내용을 다시 팝업으로 알리기" hint="이미 확인한 멤버에게도 다시 띄우고 알림을 보내요" />
            )}
            <Check checked={draft.pinned} disabled={pinLocked} onChange={(v) => setDraft((d) => ({ ...d, pinned: v }))} text="상단에 고정" hint={pinLocked ? LIMIT_TEXT.pinned : undefined} warn={pinLocked} />
          </div>
          <div className="flex justify-end gap-2 max-sm:flex-col-reverse">
            <button type="button" onClick={() => leaveForm(closeForm)} disabled={saving} className="h-11 rounded-[22px] border border-line-3 bg-surface px-5 text-[14px] font-semibold text-ink max-sm:w-full">
              취소
            </button>
            <button type="submit" disabled={saving || gone || (!isNew && !dirty)} aria-busy={saving || undefined} className="h-11 rounded-[22px] bg-navy px-6 text-[14px] font-semibold text-white disabled:opacity-50 max-sm:w-full">
              {isNew ? "등록" : "저장"}
            </button>
          </div>
          {asking && (
            <InlineConfirm
              text="저장하지 않은 수정이 있어요"
              cancelLabel="계속 고치기"
              onCancel={() => {
                setHeldHref(null);
                setBackHeld(false); // 뒤로 가기였으면 기록은 이미 다시 쌓았다
                update({ leave: null });
              }}
              actions={[{ label: "버리기", tone: "danger", onClick: discardAndGo }]}
            />
          )}
        </form>
      )}

      {loadErr && (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-x-2 rounded-[12px] bg-surface-2 px-[14px] py-3 text-[13px] text-muted">
          {loadErr}
          <button type="button" onClick={refetch} className="inline-flex min-h-11 items-center font-semibold text-mint hover:text-mint-dark">
            다시 시도
          </button>
        </p>
      )}
      {!list && !loadErr && <div aria-busy="true" aria-label="공지 불러오는 중" className="h-24 rounded-[14px] bg-line-2 motion-safe:animate-pulse" />}

      {list && list.items.length === 0 && !editing && (
        <div className="rounded-[14px] border border-dashed border-line-dash px-5 py-8 text-center">
          <p className="m-0 text-[15px] font-semibold text-ink">아직 공지가 없어요</p>
          <p className="mt-1 mb-0 text-[13px] text-muted">{canWrite ? "모두가 알아야 할 규칙이나 일정을 공지로 남겨 보세요" : "그룹장이 공지를 올리면 여기에 모여요"}</p>
        </div>
      )}

      {list && list.items.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {list.items.map((n) => {
            const open = S.noticeOpen === n.id;
            const panel = `${ids}-n${n.id}`;
            return (
              <li key={n.id} data-notice={n.id} className={`rounded-[14px] border ${open ? "border-line-3" : "border-line-2"} bg-surface`}>
                <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => toggle(n)} className="flex min-h-[56px] w-full items-center gap-2 rounded-[14px] px-4 py-3 text-left">
                  {n.pinned && (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-ink-3" role="img" aria-label="고정">
                      <path d="M16 3H8v2l1 1v5l-3 3v2h5v5l1 1 1-1v-5h5v-2l-3-3V6l1-1z" />
                    </svg>
                  )}
                  {n.popup && <span className="shrink-0 rounded-[6px] bg-mint-soft px-[6px] py-px text-[11px] font-semibold text-mint">팝업</span>}
                  <span className={`min-w-0 flex-1 truncate text-[15px] ${n.read ? "font-medium text-ink-2" : "font-bold text-ink"}`}>{n.title}</span>
                  {!n.read && (
                    <span data-unread className="size-[6px] shrink-0 rounded-full bg-warn">
                      <span className="sr-only">안 읽음</span>
                    </span>
                  )}
                  <span className="shrink-0 text-[12px] text-muted">
                    {relativeTime(n.createdAt, now)}
                    {n.edited && " · 수정됨"}
                  </span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-ink-3 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {open && (
                  <div id={panel} className="flex flex-col gap-3 border-t border-line-2 px-4 pt-3 pb-4">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 text-[12px] text-muted">
                        {n.author?.nickname ?? "알 수 없음"} · {relativeTime(n.createdAt, now)}
                        {n.edited && ` · ${relativeTime(n.updatedAt, now)} 수정`}
                      </span>
                      {/* 폼이 열린 동안은 메뉴를 숨긴다 — 고치는 중인 공지를 지우거나 고정해 폼 기준과 어긋나지 않게 */}
                      {canWrite && !editing && <MoreMenu items={menuOf(n)} label={`${n.title} 메뉴`} />}
                    </div>
                    <MarkdownView src={n.bodyMd} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog open={delId !== null} title="공지를 삭제할까요?" body="삭제하면 멤버 목록에서도 사라져요." confirmLabel="삭제" danger busy={busy} onConfirm={() => void remove()} onCancel={() => setDelId(null)} />
    </div>
  );
}

function Check({ checked, onChange, text, hint, disabled, warn }: { checked: boolean; onChange: (v: boolean) => void; text: string; hint?: string; disabled?: boolean; warn?: boolean }) {
  const hintId = useId();
  return (
    <label className={`flex items-start gap-[10px] ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} aria-describedby={hint ? hintId : undefined} onChange={(e) => onChange(e.target.checked)} className="m-0 mt-[2px] h-5 w-5 shrink-0 cursor-pointer accent-mint disabled:cursor-not-allowed" />
      <span className="flex flex-col gap-[2px]">
        <span className={`text-[14px] font-medium ${disabled ? "text-muted" : "text-ink"}`}>{text}</span>
        {hint && (
          <span id={hintId} className={`text-[12px] ${warn ? "font-medium text-amber-text" : "text-muted"}`}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}
