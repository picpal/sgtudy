"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { MoreMenu } from "@/components/ui/MoreMenu";
import type { ToastMsg } from "@/components/ui/Toast";
import { commentErrorText, createComment, deleteComment, fetchComments, updateComment } from "@/lib/api/comments";
import { toApiError } from "@/lib/api/errors";
import { relativeTime } from "@/lib/api/notifications";
import type { CommentDto, CommentPage, CommentWriteBlock } from "@/lib/api/types";
import { COMMENT_HASH_PREFIX, commentIdOfHash, useHashPrefixTarget } from "@/lib/hashTarget";
import { toEditable } from "@/lib/mention";
import { useRefetchOnFocus } from "@/lib/useRefetchOnFocus";
import { commentDraftKey } from "../commentDraft";
import { CommentBody } from "./CommentBody";
import { CommentComposer, type ComposerHandle, type MentionMember } from "./CommentComposer";
import { InlineConfirm } from "./InlineConfirm";

type Props = {
  slug: string;
  nodeId: string;
  /** 자동완성 후보 — 그룹장 + ACTIVE(D11) */
  members: MentionMember[];
  meId: string | null;
  /** 승인 대기 — 댓글을 볼 수 없다(D2). 부르지 않고 안내만 */
  viewerPending: boolean;
  toast: (m: ToastMsg) => void;
};

const BLOCK_TEXT: Record<Exclude<CommentWriteBlock, "exam_locked">, string> = {
  ended: "종료된 스터디는 댓글을 쓸 수 없어요",
  inactive: "이탈한 스터디에는 댓글을 쓸 수 없어요",
  archived_node: "보관된 항목에는 댓글을 쓸 수 없어요",
};
const LOCKED_TEXT = "시험을 제출하면 댓글을 볼 수 있어요";
/** 창으로 돌아올 때 다시 받는 간격(D19) */
const STALE_MS = 30_000;
const FLASH_MS = 2000;
// 쓰기 실패 중 화면 상태(쓰기 가능·잠금·댓글 유무)가 그새 바뀌었을 수 있는 것 — 목록을 다시 받는다
const RESYNC = new Set(["ROOM_NOT_EDITABLE", "NOT_MEMBER", "COMMENT_LOCKED", "COMMENT_NOT_FOUND", "NOT_AUTHOR", "COMMENT_LIMIT"]);

const byId = (a: CommentDto, b: CommentDto) => Number(a.id) - Number(b.id);

/**
 * 새로 받은 최신 쪽(기본 호출)을 지금 목록에 얹는다 — [이전 더 보기] 로 펼친 오래된 댓글은 남긴다.
 * 지금 목록이 딥링크 창(hasNewer: 최신 쪽이 잘림)이면 사이가 비므로 통째로 바꾼다. 최신 쪽에 더 오래된 게 없으면(hasOlder=false) 남길 것도 없다
 */
export function mergeLatest(prev: CommentPage | null, next: CommentPage): CommentPage {
  if (!prev || prev.locked || next.locked || prev.hasNewer) return next;
  const first = next.items[0];
  const keep = next.hasOlder && first ? prev.items.filter((c) => byId(c, first) < 0) : [];
  return { ...next, items: [...keep, ...next.items], people: { ...prev.people, ...next.people }, hasOlder: keep.length > 0 ? prev.hasOlder : next.hasOlder };
}

/** 이 노드의 댓글 링크인가 — 과제 ?task={id} · 회차(·과제 보기 상세) ?item={id} */
const linksTo = (nodeId: string) => (search: string) => {
  const sp = new URLSearchParams(search);
  return sp.get("task") === nodeId || sp.get("item") === nodeId;
};

const absTime = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * 회차·과제 보기 상세 하단 「댓글」 (스펙 §6.3) — 오래된 → 최신, 처음엔 최신 50 + [이전 댓글 더 보기], 아래 입력창.
 * 갱신은 실시간 없이 등록·수정·삭제 뒤 · 창으로 돌아올 때(30초 지났으면) · [새로 고침] · 딥링크 도착(D19).
 * 딥링크 #comment-{id}: from={id} 로 불러 그 댓글을 꼭 넣고, 다 그려지면 useHashPrefixTarget 이 가운데로 스크롤 + 포커스, 2초 강조(D16)
 */
export function CommentSection({ slug, nodeId, members, meId, viewerPending, toast }: Props) {
  const ids = useId();
  const [page, setPage] = useState<CommentPage | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [olderBusy, setOlderBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const lastAt = useRef(0);
  // 늦게 온 응답이 새 응답을 덮지 않게 — 마지막으로 보낸 목록 요청만 반영한다
  const seq = useRef(0);
  const deep = useRef(0);
  const deepBusy = useRef(false);
  const composer = useRef<ComposerHandle>(null);

  // ---- 딥링크 ----
  const accept = useCallback((search: string) => linksTo(nodeId)(search), [nodeId]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [want, setWant] = useState<string | null>(null);
  const hit = useHashPrefixTarget(COMMENT_HASH_PREFIX, !!want && loadedFor === want, { fallbackId: "comments", accept });
  // 훅이 찾아간 뒤 null 로 돌아와도 목록은 그대로 둔다 — 새 딥링크(같은 해시를 다시 알린 것 포함)만 다시 부른다
  const [seenHit, setSeenHit] = useState(hit);
  if (hit !== seenHit) {
    setSeenHit(hit);
    if (hit) {
      setWant(hit);
      setLoadedFor(null);
    }
  }

  const apply = useCallback((p: CommentPage, merge: boolean) => {
    setPage((prev) => (merge ? mergeLatest(prev, p) : p));
    setLoadErr(null);
    lastAt.current = Date.now();
  }, []);

  // 처음·[새로 고침]·창 복귀 — 최신 쪽
  useEffect(() => {
    if (viewerPending) return;
    const my = ++seq.current;
    // 딥링크 조회 중이면 그 응답(그 댓글을 꼭 담은 목록)이 이긴다 — 최신 쪽 응답은 버린다
    fetchComments(slug, nodeId)
      .then((p) => my === seq.current && !deepBusy.current && apply(p, true))
      .catch((e) => my === seq.current && !deepBusy.current && setLoadErr(commentErrorText(toApiError(e))));
  }, [slug, nodeId, viewerPending, tick, apply]);

  // 딥링크 — 그 댓글부터(from). 없거나 지워졌으면 서버가 최신 쪽을 주고 target 으로 알린다
  useEffect(() => {
    if (!want || viewerPending) return;
    // 딥링크는 자기 번호로만 버린다(더 새 딥링크가 왔을 때) — [새로 고침]·창 복귀 조회가 끼어도 반드시 끝을 맺어(done) 훅이 찾아가고 해시를 지운다 (리뷰 M7)
    const myDeep = ++deep.current;
    deepBusy.current = true;
    const from = commentIdOfHash(want);
    const done = () => {
      deepBusy.current = false;
      setLoadedFor(want);
    };
    fetchComments(slug, nodeId, from ? { from } : {})
      .then((p) => {
        if (myDeep !== deep.current) return;
        seq.current++; // 그 전에 출발한 최신 쪽·이전 더 보기 응답은 버린다
        apply(p, false);
        if (p.locked) {
          // 잠금 안내가 곧 답이다 — 섹션으로만
        } else if (!from || p.target?.state === "missing") toast({ text: "댓글을 찾을 수 없어요", tone: "bad" });
        else if (p.target?.state === "deleted") toast({ text: "삭제된 댓글이에요", tone: "bad" });
        else setFlash(from);
        done();
      })
      .catch((e) => {
        if (myDeep !== deep.current) return;
        seq.current++;
        setLoadErr(commentErrorText(toApiError(e)));
        done();
      });
  }, [want, slug, nodeId, viewerPending, apply, toast]);
  // 찾아간 뒤에는 원래대로 — 다음 딥링크를 기다린다
  useEffect(() => {
    if (!hit && want && loadedFor === want) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 훅이 찾아간 뒤 한 번
      setWant(null);
    }
  }, [hit, want, loadedFor]);
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(t);
  }, [flash]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useRefetchOnFocus(!viewerPending && page !== null, () => {
    if (Date.now() - lastAt.current > STALE_MS) refresh();
  });

  const loadOlder = async () => {
    const first = page?.items[0];
    if (!page || !first || olderBusy) return;
    setOlderBusy(true);
    const my = seq.current; // 이 사이에 목록을 새로 받으면 버린다
    try {
      const p = await fetchComments(slug, nodeId, { before: first.id });
      if (my !== seq.current) return;
      setPage((prev) => prev && { ...prev, items: [...p.items, ...prev.items.filter((c) => !p.items.some((x) => x.id === c.id))], people: { ...p.people, ...prev.people }, hasOlder: p.hasOlder, total: p.total });
    } catch (e) {
      toast({ text: commentErrorText(toApiError(e)), tone: "bad" });
    } finally {
      setOlderBusy(false);
    }
  };

  const failed = (e: unknown) => {
    const err = toApiError(e);
    toast({ text: commentErrorText(err), tone: "bad" });
    if (RESYNC.has(err.code)) refresh();
    return false;
  };

  const create = async (body: string) => {
    try {
      const r = await createComment(slug, nodeId, body);
      if (page?.hasNewer) refresh(); // 딥링크 창 — 최신 쪽이 잘려 있어 그냥 붙이면 사이가 빈다
      else
        setPage((prev) =>
          prev && { ...prev, items: [...prev.items.filter((c) => c.id !== r.comment.id), r.comment].sort(byId), people: { ...prev.people, ...r.people }, total: prev.total + 1 },
        );
      lastAt.current = Date.now();
      return true;
    } catch (e) {
      return failed(e);
    }
  };

  const save = (id: string) => async (body: string) => {
    try {
      const r = await updateComment(slug, id, body);
      setPage((prev) => prev && { ...prev, items: prev.items.map((c) => (c.id === id ? r.comment : c)), people: { ...prev.people, ...r.people } });
      setEditing(null);
      requestAnimationFrame(() => document.getElementById(`comment-${id}`)?.focus({ preventScroll: true }));
      return true;
    } catch (e) {
      return failed(e);
    }
  };

  const remove = async (id: string) => {
    setAsking(null);
    try {
      await deleteComment(slug, id);
      setPage((prev) => prev && { ...prev, items: prev.items.filter((c) => c.id !== id), total: Math.max(0, prev.total - 1) });
      toast({ text: "댓글을 지웠어요", tone: "ok" });
      document.getElementById("comments")?.focus({ preventScroll: true });
    } catch (e) {
      failed(e);
    }
  };

  const openEdit = (id: string) => {
    setAsking(null);
    setEditing(id);
  };
  const openDelete = (id: string) => {
    setEditing(null);
    setAsking(id);
  };

  const heading = (
    <h3 id={`${ids}-h`} className="m-0 text-[16px] font-bold text-ink">
      댓글{page && <span className="ml-[6px] font-semibold text-ink-3">{page.total}</span>}
    </h3>
  );
  const note = (text: string) => (
    <p role="note" className="m-0 rounded-[12px] bg-surface-2 px-[14px] py-3 text-[13px] text-muted">
      {text}
    </p>
  );
  const now = new Date();

  return (
    <section id="comments" tabIndex={-1} aria-labelledby={`${ids}-h`} data-comments={nodeId} className="flex scroll-mt-24 flex-col gap-3 border-t border-line-2 pt-5 outline-none">
      {heading}
      {viewerPending ? (
        note("참가가 승인되면 댓글을 볼 수 있어요")
      ) : loadErr && !page ? (
        <p role="alert" className="m-0 flex flex-wrap items-center gap-x-2 rounded-[12px] bg-surface-2 px-[14px] py-3 text-[13px] text-muted">
          {loadErr}
          <button type="button" onClick={refresh} className="inline-flex min-h-11 items-center font-semibold text-mint hover:text-mint-dark">
            다시 시도
          </button>
        </p>
      ) : !page ? (
        <div aria-busy="true" aria-label="댓글 불러오는 중" className="h-16 rounded-[14px] bg-line-2 motion-safe:animate-pulse" />
      ) : page.locked ? (
        note(LOCKED_TEXT)
      ) : (
        <>
          {page.hasOlder && (
            <button type="button" onClick={() => void loadOlder()} disabled={olderBusy} aria-busy={olderBusy || undefined} className="h-11 self-start rounded-[22px] border border-line-3 bg-surface px-4 text-[13px] font-semibold text-ink-2 disabled:opacity-60">
              {/* 딥링크 창(hasNewer)은 잘린 최신 쪽까지 세게 되므로 숫자 없이 */}
              {!page.hasNewer && page.total > page.items.length ? `이전 댓글 ${page.total - page.items.length}개 더 보기` : "이전 댓글 더 보기"}
            </button>
          )}
          {page.items.length === 0 ? (
            <p className="m-0 rounded-[14px] border border-dashed border-line-dash px-5 py-6 text-center text-[13px] text-muted">{page.canWrite ? "첫 댓글을 남겨 보세요" : "아직 댓글이 없어요"}</p>
          ) : (
            <ol className="m-0 flex list-none flex-col p-0">
              {page.items.map((c) => {
                const nick = c.author?.nickname ?? "알 수 없음";
                const menu = [
                  ...(c.canEdit ? [{ key: "edit", label: "수정", onSelect: () => openEdit(c.id) }] : []),
                  ...(c.canDelete ? [{ key: "del", label: "삭제", danger: true, onSelect: () => openDelete(c.id) }] : []),
                ];
                return (
                  <li
                    key={c.id}
                    id={`comment-${c.id}`}
                    tabIndex={-1}
                    data-comment={c.id}
                    data-flash={flash === c.id || undefined}
                    className={`flex scroll-my-24 gap-3 rounded-[12px] px-2 py-3 outline-none transition-colors duration-700 focus-visible:ring-2 focus-visible:ring-mint motion-reduce:transition-none ${
                      flash === c.id ? "bg-mint-soft motion-reduce:bg-transparent motion-reduce:outline-2 motion-reduce:outline-mint motion-reduce:outline" : ""
                    }`}
                  >
                    <Avatar name={nick} size={32} tone={c.author?.tone} id={c.author?.userId} className="mt-[2px]" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="text-[14px] font-semibold text-ink [overflow-wrap:anywhere]">{nick}</span>
                        <time dateTime={c.createdAt} title={absTime(c.createdAt)} className="text-[12px] text-muted">
                          {relativeTime(c.createdAt, now)}
                        </time>
                        {c.edited && <span className="text-[12px] text-muted">· 수정됨</span>}
                        <div className="ml-auto flex items-center gap-1">
                          {page.canWrite && c.author && !c.mine && editing !== c.id && (
                            <button
                              type="button"
                              aria-label={`${nick}님에게 답글`}
                              onClick={() => composer.current?.reply({ userId: c.author!.userId, nickname: c.author!.nickname })}
                              className="relative h-8 rounded-[16px] px-2 text-[12px] font-semibold text-ink-3 before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-[''] hover:text-ink"
                            >
                              답글
                            </button>
                          )}
                          {menu.length > 0 && editing !== c.id && <MoreMenu items={menu} label={`${nick}님 댓글 메뉴`} />}
                        </div>
                      </div>
                      {editing === c.id ? (
                        <CommentComposer
                          members={members}
                          meId={meId}
                          initial={toEditable(c.body, page.people)}
                          submitLabel="저장"
                          label={`${nick}님 댓글 고치기`}
                          onSubmit={save(c.id)}
                          onCancel={() => {
                            setEditing(null);
                            document.getElementById(`comment-${c.id}`)?.focus({ preventScroll: true });
                          }}
                          autoFocus
                        />
                      ) : (
                        <div className="text-[14px] leading-[1.7] text-ink-2 [overflow-wrap:anywhere]">
                          <CommentBody body={c.body} people={page.people} meId={meId} />
                        </div>
                      )}
                      {asking === c.id && (
                        <InlineConfirm
                          text={c.mine ? "이 댓글을 지울까요?" : "그룹장 권한으로 이 댓글을 지울까요?"}
                          onCancel={() => setAsking(null)}
                          actions={[{ label: "삭제", tone: "danger", onClick: () => void remove(c.id) }]}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {page.canWrite ? (
            <CommentComposer
              ref={composer}
              members={members}
              meId={meId}
              draftKey={meId ? commentDraftKey(nodeId, meId) : null}
              submitLabel="등록"
              label="댓글 쓰기"
              onSubmit={create}
            />
          ) : (
            page.writeBlock && page.writeBlock !== "exam_locked" && note(BLOCK_TEXT[page.writeBlock])
          )}
          <button type="button" onClick={refresh} className="h-11 self-start rounded-[22px] px-2 text-[13px] font-semibold text-ink-3 hover:text-ink">
            새로 고침
          </button>
        </>
      )}
    </section>
  );
}
