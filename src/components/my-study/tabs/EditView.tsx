"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import type { ToastMsg } from "@/components/ui/Toast";
import type { TaskType } from "@/data/my-study";
import { holdSamePage, samePage, setLeaveGuard } from "@/lib/leaveGuard";
import { useToday } from "@/lib/today";
import { rangeShort } from "@/lib/api/format";
import { fetchNodeFiles } from "@/lib/api/nodeFiles";
import type { FileMeta } from "@/lib/api/types";
import { Seg } from "../bits";
import { dropFieldOv, isDirty, isPersonal, leafLocks, periodWarnings, removePlan, type ParentNode, type TreeMember, type TreeNode } from "../model";
import { NODE_FILE_HINT, sameIds } from "../nodeFiles";
import { designatedHint, moveNote, movedPeriod, reorderIndex, roundOf, roundOptions, sameShiftAsk, shiftAskOf, shiftAskText, type ShiftAsk } from "../rounds";
import { editReturn, patchOv, type Leave, type ScreenState, type Update } from "../state";
import type { RoomStatus } from "../submission";
import { dropKey, type CurriculumApi } from "../useCurriculumApi";
import { useNodeFileUploads } from "../useNodeFileUploads";
import { DATE_NO_OVERFLOW_CLASS } from "@/components/room-new/fields";
import { ChildList } from "./ChildList";
import { ExamAiTab } from "./ExamAiTab";
import { ExamEditor, type ExamEditorHandle } from "./ExamEditor";
import { FileUploadList } from "./FileUploadList";
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
  /** 방 상태 — 시작 전 지정 과제 안내 (시나리오 QA #12) */
  roomStatus?: RoomStatus;
  /** 첨부 업로드 안내·오류 */
  toast: (m: ToastMsg) => void;
  /** 방 주소 — 시험 리프의 「문제」 섹션(exam_* RPC) */
  slug: string;
};

const NO_FILES: FileMeta[] = [];
const FILES_ERR = "첨부 파일 목록을 불러오지 못했어요 · 새로 고침해 주세요";

const field = "h-11 rounded-[10px] border border-line-3 text-ink";
const label = "flex flex-col gap-[6px] text-[12px] font-semibold text-ink-3";

/**
 * 그룹장 편집 — 커리큘럼 목록 자리를 통째로 쓰는 전용 편집 화면 (?item=).
 * 글(설명)이 주인공: 제목 한 줄 → 기간·유형 한 줄 → 남은 높이를 채우는 마크다운 편집기. 저장·삭제는 위쪽 고정 막대에 늘 보인다.
 * 내용 변경은 오버라이드에 모았다가 "저장" 1회(node_update), 삭제·보관은 즉시 RPC.
 */
export function EditView({ n, parent, nodes, roots, period, members, S, update, api, go, request, roomStatus = "active", toast, slug }: Props) {
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

  // 저장 요청이 나가 있는 동안 — 두 저장 버튼·첨부 고르기/빼기를 막는다(두 번 눌러 node_update 가 두 번 가지 않게).
  // savingRef 는 같은 틱의 두 번째 클릭도 막는 동기 표시, editedMid 는 저장 중에 또 고쳤는지 — 그러면 저장 뒤 떠나지 않는다(고친 것을 묻지 않고 버리지 않게)
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const editedMid = useRef(false);
  const edit: Update = (patch) => {
    if (savingRef.current) editedMid.current = true;
    update(patch);
  };
  // 첨부 — 붙은 목록은 서버(node_files), 고친 선택은 ov.files 에 모았다가 "저장" 때 node_files_set. 임시 행은 저장한 뒤에 붙인다
  const [savedFiles, setSavedFiles] = useState<FileMeta[] | null>(null);
  // 못 불러오면 빈 목록으로 보지 않는다 — node_files_set 은 통째 교체라 일부 목록으로 저장하면 붙은 파일이 지워진다 (리뷰 I-1)
  const [filesErr, setFilesErr] = useState(false);
  useEffect(() => {
    if (n.temp) return;
    void fetchNodeFiles(id)
      .then(setSavedFiles)
      .catch(() => {
        setFilesErr(true);
        toast({ text: FILES_ERR, tone: "bad" });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 항목이 바뀔 때만 (toast 참조가 바뀌어도 다시 부르지 않는다)
  }, [id, n.temp]);
  const saved = savedFiles ?? NO_FILES; // 같은 참조 — 훅이 saved 바뀜을 참조로 본다
  const savedIds = useMemo(() => saved.map((f) => f.id), [saved]);
  const up = useNodeFileUploads({
    nodeId: n.temp ? null : id,
    saved,
    selected: S.ov.files[id] ?? savedIds,
    toast,
    onSelect: (ids) => edit((p) => ({ ...patchOv(p, "files", sameIds(ids, savedIds) ? dropKey(p.ov.files, id) : { ...p.ov.files, [id]: ids }), saved: "" })),
  });
  // 저장 응답 뒤(await 다음) 읽는 지금 값 — 렌더 중이 아니라 effect 에서 맞춘다
  const uploadingRef = useRef(up.uploading);
  useEffect(() => {
    uploadingRef.current = up.uploading;
  });
  // 올리는 중이면 ov 수정이 없어도 떠나기 전에 묻는다 (CurriculumTab·MyStudyScreen 은 S.uploading 을 본다)
  useEffect(() => {
    if (!up.uploading) return;
    update({ uploading: id });
    return () => update((p) => (p.uploading === id ? { uploading: null } : {}));
  }, [up.uploading, id, update]);

  // 시험 리프의 「문제」 섹션 — 문항 수정은 [문제 저장](exam_put) 따로. 저장 안 한 문항이 있으면 S.examDirty 로 올려
  // 올리는 중(S.uploading)과 같은 "저장하지 않은 수정이 있어요" 경로로 탭·뒤로 가기·다른 항목 이동을 막는다 (Review Focus 10)
  const exam = n.leaf && !n.temp && n.exam ? n.exam : null;
  const examRef = useRef<ExamEditorHandle>(null);
  const [examDirty, setExamDirty] = useState(false);
  useEffect(() => {
    if (!examDirty) return;
    update({ examDirty: id });
    return () => update((p) => (p.examDirty === id ? { examDirty: null } : {}));
  }, [examDirty, id, update]);

  // 저장하지 않은 수정이 있는 채로 새로고침·탭 닫기·다른 문서로 이동(전체 다시 불러오기가 되는 뒤로 가기 포함) → 브라우저 확인.
  // 앱 안 이동은 아래 "저장하지 않은 수정이 있어요" 확인이 맡는다
  const dirty = isDirty(S.ov, id);
  const unsaved = dirty || up.uploading || examDirty;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // 옛 Safari·Chrome 은 returnValue 가 있어야 묻는다
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  // 앱 안 링크(헤더 메뉴·로고·옆 목록)로 다른 화면에 가려 하면 — 미저장 수정은 아래 확인으로 보류(Q2-1),
  // 저장한 적 없는 새 회차(빈 채)는 지우고 그대로 보낸다(Q2-8 — 화면이 사라져 MyStudyScreen 의 정리가 돌지 않는다)
  const fresh = S.fresh === id && !n.leaf && n.kids.every(isPersonal);
  useEffect(() => {
    if (!unsaved && !fresh) return;
    return setLeaveGuard((href) => {
      if (unsaved) {
        update({ leave: { href }, confirm: false });
        return true;
      }
      // 같은 방 주소(헤더 "내 스터디" 등 task·tab 없는 주소)는 화면이 다시 그려지지 않는다 — 이동 대신 목록으로 닫고,
      // (?task=·?tab= 이 있는 같은 방 알림 링크는 화면이 다시 마운트되니 아래로 가서 지우고 이동한다, N-1)
      // 빈 새 회차는 MyStudyScreen 정리가 상태째 지운다(서버만 지우면 지워진 회차의 편집 화면이 남는다, 최종 리뷰 Minor 1)
      // 해시 알림 링크(#applications 등)는 편집만 닫고 이동은 막지 않는다 — 벨이 이동·앵커·읽음까지 이어 간다 (최종 리뷰 I2)
      if (samePage(href)) {
        go({ sel: null });
        return holdSamePage(href);
      }
      api.discard(id);
      return false;
    });
  }, [unsaved, fresh, id, api, update, go]);

  const today = useToday();
  const warns = periodWarnings(n, parent, period, today);
  const ids = n.leaf ? n.people.map((p) => p.userId) : [];
  // 보관된 하위의 제출도 센다 — 서버는 하위 어디에든 제출이 있으면 삭제를 막는다
  const hasSub = n.subAll > 0;
  const isGong = n.leaf && n.type === "공통";
  // 제출이 있으면 유형 변경·제출한 담당자 빼기를 미리 막는다 (시나리오 QA #11 — 저장 때 서버 거절 토스트 대신)
  const locks = n.leaf ? leafLocks(n) : null;
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
    edit((p) => ({ ...patchOv(p, "dates", { ...p.ov.dates, [id]: { ...(p.ov.dates[id] ?? {}), [k]: v } }), saved: "" }));
  };
  // 개인 목표는 편집 모드에 그려지지 않는 전제 — 그래도 들어오면 유형·담당을 바꾸지 않는다(지정으로 떨어지지 않게)
  const isPersonalLeaf = n.leaf && n.personal;
  const setType = (t: TaskType) => {
    if (isPersonalLeaf || locks?.typeReason) return;
    edit((p) => ({
      ov: { ...p.ov, typeOv: { ...p.ov.typeOv, [id]: t }, assignOv: t === "지정" ? { ...p.ov.assignOv, [id]: p.ov.assignOv[id] ?? ids } : p.ov.assignOv },
      saved: "",
    }));
  };
  const toggleMember = (m: TreeMember) => {
    if (isGong || isPersonalLeaf) return;
    if (ids.includes(m.userId) && locks?.lockedIds.has(m.userId)) return;
    const next = ids.includes(m.userId) ? ids.filter((x) => x !== m.userId) : [...ids, m.userId];
    edit((p) => ({ ...patchOv(p, "assignOv", { ...p.ov.assignOv, [id]: next }), saved: "" }));
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
  // 회차·묶음 시작일을 옮겼으면 저장 전에 "하위도 같은 날수만큼 옮길까요?" (시나리오 QA D2). then = 저장 뒤 이동할 곳(떠나기 전 저장)
  const [shiftAsk, setShiftAsk] = useState<{ ask: ShiftAsk; then: typeof S.leave } | null>(null);
  const doSave = async (shift: boolean, then: typeof S.leave) => {
    if (savingRef.current) return;
    savingRef.current = true;
    editedMid.current = false;
    setSaving(true);
    setShiftAsk(null);
    let text = "저장했어요";
    let ok = false;
    try {
      // 저장하지 않은 시험 문항도 함께 — 위쪽 [저장] 이 고친 문항을 묻지 않고 버리지 않게. 문항 저장이 거절되면(검사·잠김) 머문다
      ok = !examDirty || (await examRef.current?.save()) !== false;
      if (ok && !dirty && examDirty) update({ saved: (text = "문제를 저장했어요") });
      else if (ok) ok = await api.save(n, S.ov, { shift, onFiles: setSavedFiles, skipFiles: savedFiles === null, onSaved: (t) => (text = t) });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (ok) {
      update({ fresh: null });
      // 저장하는 사이 또 고쳤거나 파일을 올리기 시작했으면 떠나지 않는다 — 머물러 평소처럼(미저장 표시·떠나기 확인) 이어 간다
      if (then && !editedMid.current && !uploadingRef.current) {
        // 화면을 떠나면 막대의 저장 문구(S.saved)가 사라진다 — 토스트로 알린다
        toast({ text, tone: "ok" });
        go(then);
      } else if (then) update({ leave: null });
    } else if (then) update({ leave: null });
  };
  const trySave = (then: typeof S.leave) => {
    const ask = shiftAskOf(n, nodes);
    if (ask) {
      if (then) update({ leave: null });
      setShiftAsk({ ask, then });
    } else void doSave(false, then);
  };
  const leaveSave = () => trySave(S.leave);
  // [저장] = 저장한 뒤 편집에 들어오기 전 화면으로(상세·목록, 모르면 같은 항목 상세). 바뀐 게 없으면 저장 없이 돌아간다.
  // 이동은 go — request 가 아니라 "저장하지 않은 수정" 확인을 거치지 않는다(성공하면 수정은 이미 지워졌다). [임시저장] = 저장하고 머문다
  const saveAndReturn = () => {
    if (dirty || examDirty) return trySave(editReturn(S));
    // 저장한 적 없는 새 회차도 [저장] 을 눌렀으면 남긴다 (예전 "저장" 이 fresh 를 지운 것과 같게 — 빈 회차 정리 대상에서 뺀다)
    if (S.fresh === id) update({ fresh: null });
    go(editReturn(S));
  };
  // 확인을 띄운 뒤 날짜를 또 바꿨거나 다른 이동 확인(S.leave)이 떴으면 그 질문은 낡았다 — 숨기고 다시 "저장" 으로 묻는다 (최종 리뷰 Minor 4)
  const askShown = shiftAsk && !S.leave && sameShiftAsk(shiftAsk.ask, shiftAskOf(n, nodes)) ? shiftAsk : null;
  const leaveDiscard = () => {
    const to = S.leave;
    // 올린 채 저장하지 않은 첨부도 버린다 — 선택 id(ov.files)는 dropFieldOv 가 함께 지운다
    up.discardUnsaved();
    examRef.current?.discard();
    update((p) => ({ ov: dropFieldOv(p.ov, id) }));
    // 다른 화면으로 가면 이 화면이 사라진다 — 저장한 적 없는 새 회차는 여기서 지운다(앱 안 이동은 MyStudyScreen 이 맡는다)
    if (to && "href" in to && fresh && !samePage(to.href)) api.discard(id);
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
        {/* 좁은 화면(390)에서 버튼이 한 줄에 다 안 들어가면(보관 해제·올리는 중 문구) 오른쪽 버튼 묶음째 다음 줄로 — 가로 스크롤 없음 */}
        <div className="flex flex-wrap items-center gap-2">
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
          {n.temp && <span className="shrink-0 text-[12px] text-muted max-sm:hidden">서버에 만드는 중…</span>}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {/* 상위 보관으로 함께 숨겨진 항목은 자기 보관이 아니라 해제할 대상이 없다 → 버튼을 숨긴다 */}
            {/* 확인 상자가 떠 있는 동안은 숨긴다 — 빨간 "삭제" 가 두 개 보이지 않게 (Q2-22) */}
            {!n.archivedByParent && !S.confirm && (
              <button ref={removeBtn} type="button" disabled={n.temp} onClick={askRemove} className="h-11 shrink-0 rounded-[22px] border border-[#EBC3BD] bg-surface px-4 text-[14px] font-semibold text-warn disabled:opacity-50 max-sm:px-3">
                {removeLabel}
              </button>
            )}
            {/* [임시저장] = 저장하고 머문다(보조), [저장] = 저장하고 들어오기 전 화면으로(주). 올리는 중엔 둘 다 막는다 (리뷰 M-1) */}
            <button type="button" disabled={n.temp || !!askShown || up.uploading || saving || (!dirty && !examDirty)} onClick={() => trySave(null)} className="h-11 shrink-0 rounded-[22px] border border-line-3 bg-surface px-4 text-[14px] font-semibold text-ink disabled:opacity-50 max-sm:px-3">
              임시저장
            </button>
            <button type="button" disabled={n.temp || !!askShown || up.uploading || saving} aria-busy={saving || undefined} onClick={saveAndReturn} className="h-11 shrink-0 rounded-[22px] bg-navy px-6 text-[14px] font-semibold text-white disabled:opacity-50 max-sm:px-4">
              {up.uploading ? "파일을 올리는 중이에요" : "저장"}
            </button>
          </div>
        </div>
        {S.saved && (
          <div role="status" className="rounded-[10px] bg-mint-soft px-3 py-2 text-[13px] font-semibold text-mint-deep">
            {S.saved}
          </div>
        )}
        {askShown && (
          <InlineConfirm
            text={shiftAskText(askShown.ask)}
            cancelLabel="계속 편집"
            onCancel={() => setShiftAsk(null)}
            actions={[
              // 올리는 중엔 저장하지 않는다 — 올리던 파일이 빠진 채 저장된다 (리뷰 M-1)
              { label: "함께 옮기기", tone: "primary", onClick: () => void doSave(true, askShown.then), disabled: up.uploading || saving },
              { label: kind === "회차" ? "회차만 바꾸기" : "이 묶음만 바꾸기", onClick: () => void doSave(false, askShown.then), disabled: up.uploading || saving },
            ]}
          />
        )}
        {S.leave && (
          // 올리는 중이면 "저장하고 이동" 은 없다 — 기다리지 않고 막는다 (리뷰 I-2: 저장하면 올리던 파일이 빠진다)
          <InlineConfirm
            text={up.uploading ? (dirty || examDirty ? "파일을 올리는 중이에요. 지금 나가면 올리던 파일과 저장하지 않은 수정은 버려져요" : "파일을 올리는 중이에요. 지금 나가면 올리던 파일은 버려져요") : "저장하지 않은 수정이 있어요. 저장할까요?"}
            cancelLabel="계속 편집"
            onCancel={() => update({ leave: null })}
            actions={[{ label: "버리기", onClick: leaveDiscard }, ...(up.uploading ? [] : [{ label: "저장하고 이동", onClick: () => void leaveSave(), tone: "primary" as const, disabled: saving }])]}
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
          <input ref={titleInput} type="text" value={n.title} disabled={n.temp} onChange={(e) => edit((p) => ({ ...patchOv(p, "titles", { ...p.ov.titles, [id]: e.target.value }), saved: "" }))} className={`${field} h-[52px] px-[14px] text-[18px] font-bold disabled:bg-surface-2`} />
        </label>

        {/* 기간·유형은 한 줄에 — 좁으면 접어 내린다. 회차·묶음의 하위 집계는 같은 줄 끝의 보조 글 */}
        <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
          <label className={`${label} min-w-0 flex-[0_1_180px] max-sm:flex-[1_1_140px]`}>
            시작일
            <input type="date" value={n.s} disabled={n.temp} onChange={(e) => setDate("s", e.target.value)} className={`${field} min-w-0 px-[10px] text-[14px] ${DATE_NO_OVERFLOW_CLASS}`} />
          </label>
          <label className={`${label} min-w-0 flex-[0_1_180px] max-sm:flex-[1_1_140px]`}>
            마감일
            <input type="date" value={n.e} disabled={n.temp} onChange={(e) => setDate("e", e.target.value)} className={`${field} min-w-0 px-[10px] text-[14px] ${DATE_NO_OVERFLOW_CLASS}`} />
          </label>
          {n.leaf && !n.personal && (
            <div className={`${label} min-w-0 flex-[0_1_300px] max-sm:flex-[1_1_100%]`}>
              <span>과제 유형</span>
              <div className="[&_button]:h-11">
                <Seg<TaskType> label="과제 유형" value={n.type} onChange={setType} grow disabled={!!locks?.typeReason} describedBy={locks?.typeReason ? `type-lock-${id}` : undefined} options={[["공통", "공통 · 참가자 전원"], ["지정", "지정 · 일부 인원"]]} />
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
                        .move(id, to.id, undefined, period ? [{ id, ...period }] : [], period ? `${to.label}로 옮겼어요 · 기간 ${rangeShort(period.s, period.e, today)}` : `${to.label}로 옮겼어요`)
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

        {/* 제출이 있는 과제 — 유형 잠금 이유 (시나리오 QA #11). 기간·유형 줄의 세로 정렬을 흔들지 않게 줄 밖에 */}
        {locks?.typeReason && (
          <p id={`type-lock-${id}`} className="m-0 -mt-1 text-[12px] font-medium text-muted">
            과제 유형: {locks.typeReason} · 바꾸려면 보관하고 새 과제를 만들어 주세요
          </p>
        )}

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
              onAdd: (t, ty, kind) => api.create(n.id, { title: t, open: false, taskType: ty === "지정" ? "designated" : "common", ...(kind === "exam" ? { exam: true } : {}) }),
              designatedNote: designatedHint(roomStatus),
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
                const locked = !isGong && on && !!locks?.lockedIds.has(m.userId);
                return (
                  <button
                    key={m.userId}
                    type="button"
                    aria-pressed={on}
                    aria-disabled={isGong || locked}
                    aria-describedby={locked ? `assign-lock-${id}` : undefined}
                    onClick={() => toggleMember(m)}
                    className={`inline-flex h-11 items-center gap-[6px] rounded-[22px] border py-0 pl-[8px] pr-[14px] text-[13px] text-ink ${on ? "border-[#3FB89C] bg-[#E8F7F2] font-semibold" : "border-line-3 bg-surface font-medium"}`}
                    style={{ opacity: isGong ? 0.7 : 1, cursor: isGong || locked ? "default" : "pointer" }}
                  >
                    <Avatar name={m.name} size={24} tone={m.tone} />
                    {m.name}
                    {locked && <span className="text-[11px] font-medium text-muted">제출함</span>}
                  </button>
                );
              })}
            </div>
            {!isGong && locks && locks.lockedIds.size > 0 && (
              <span id={`assign-lock-${id}`} className="text-[12px] font-medium text-muted">
                {locks.assignReason} · 담당을 바꾸려면 과제를 보관해 주세요
              </span>
            )}
            {!isGong && designatedHint(roomStatus) && (
              <span role="note" className="rounded-[9px] bg-surface-2 px-[10px] py-2 text-[12px] text-ink-2">
                {designatedHint(roomStatus)}
              </span>
            )}
            {!isGong && ids.length === 0 && (
              <span role="status" className="rounded-[9px] bg-[#FDF4E1] px-[10px] py-2 text-[12px] font-semibold text-amber-text">
                담당자 미정 · 시작 전에 한 명 이상 지정해 주세요
              </span>
            )}
          </div>
        )}

        {exam && (
          <ExamEditor
            ref={examRef}
            slug={slug}
            nodeId={id}
            summary={exam}
            assignees={ids.length}
            toast={toast}
            onDirty={setExamDirty}
            onChanged={() => void api.refresh()}
            ai={(ed, goManual) => <ExamAiTab slug={slug} nodeId={id} ed={ed} goManual={goManual} toast={toast} />}
          />
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
            onChange={(v) => edit((p) => ({ ...patchOv(p, "descs", { ...p.ov.descs, [id]: v }), saved: "" }))}
            placeholder="목표, 참고 링크, 제출 형식 등을 적어 주세요"
            minHeight={n.leaf ? "max(420px, calc(100dvh - 520px))" : "420px"}
            maxHeight="none"
            stickyToolbar="var(--edit-bar-h, 68px)"
          />
        </div>

        <FileUploadList
          label="첨부 파일 (선택)"
          hint={n.temp ? "저장한 뒤 파일을 붙일 수 있어요" : filesErr ? FILES_ERR : `끌어다 놓아도 돼요 · ${NODE_FILE_HINT}`}
          rows={up.rows}
          onPick={up.pick}
          onRemove={up.remove}
          onRetry={up.retry}
          canRetry={up.canRetry}
          disabled={n.temp || savedFiles === null || saving}
        />
      </div>
    </section>
  );
}
