"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LeaderPanel } from "@/components/room-view/LeaderPanel";
import { AppHeader } from "@/components/ui/AppHeader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { canEditCurriculumOf, toSidebarGroups, toStudyRoom } from "@/lib/api/my-study";
import { cancelApplication, leaveRoom } from "@/lib/api/room-view";
import type { Curriculum, MeStudies, RoomDetail } from "@/lib/api/types";
import { useMe } from "@/lib/me";
import { routes } from "@/lib/routes";
import { TodayProvider } from "@/lib/today";
import { itemFromUrl, readItem, readMode, syncStep, withItem } from "./editUrl";
import { EMPTY_OVERRIDES, buildTree, findNode, isDirty, stripFieldOv } from "./model";
import { currentRoundId } from "./rounds";
import { INITIAL_STATE, goLeafPatch, type CurMode, type Patch, type ScreenState } from "./state";
import { StudySidebar } from "./StudySidebar";
import { StudyHeaderInfo, type TabId } from "./StudyHeaderInfo";
import { OverviewTab } from "./tabs/OverviewTab";
import { JoinInfoCard } from "./tabs/JoinInfoCard";
import { CurriculumTab } from "./tabs/CurriculumTab";
import { BoardTab } from "./tabs/BoardTab";
import { CalendarTab } from "./tabs/CalendarTab";
import { MemberAdminCard } from "./tabs/MemberAdminCard";
import { GanttTab } from "./tabs/GanttTab";
import { useCurriculumApi } from "./useCurriculumApi";

type Props = { detail: RoomDetail; curriculum: Curriculum; studies: MeStudies; initialTab?: TabId; initialMode?: CurMode; initialLeaf?: string; initialItem?: string };

export function MyStudyScreen({ detail, curriculum, studies, initialTab = "overview", initialMode = "view", initialLeaf, initialItem }: Props) {
  const me = useMe();
  const router = useRouter();
  const isLeader = detail.me?.state === "leader";
  const [cur, setCur] = useState(curriculum);
  // 커리큘럼 편집 — 그룹장 + 그룹장이 권한을 준 팀원. node_* 응답의 myPermissions 로 갱신된다(거둬지면 false)
  const canEdit = canEditCurriculumOf({ myPermissions: cur.myPermissions, me: detail.me });
  // 알림 링크 ?task={nodeId}(D8): 그 리프가 이 방 커리큘럼에 있으면 커리큘럼 탭 + 리프 열림으로 시작(goLeafPatch 가 tab 을 curriculum 으로 바꾼다)
  const focusLeaf = initialLeaf && curriculum.nodes.some((n) => n.id === initialLeaf && n.task) ? initialLeaf : null;
  // ?item=: 새로고침하면 같은 화면 — 편집 권한 + mode=edit 이면 편집 화면, 아니면 보기 상세. 없는 id 면 목록 — 아래 URL 동기화가 주소에서 지운다
  const itemInit: Partial<ScreenState> =
    !focusLeaf && initialItem && curriculum.nodes.some((n) => n.id === initialItem)
      ? canEditCurriculumOf({ myPermissions: curriculum.myPermissions, me: detail.me }) && initialMode === "edit"
        ? { tab: "curriculum", curMode: "edit", editSel: initialItem }
        : { tab: "curriculum", curMode: "view", viewSel: initialItem }
      : {};
  const [S, setS] = useState<ScreenState>({
    ...INITIAL_STATE,
    tab: initialTab,
    // 보드는 스프린트 보드처럼 현재 회차로 시작 (칩으로 "전체" 선택 가능)
    bRound: currentRoundId(buildTree(curriculum, EMPTY_OVERRIDES, curriculum.today).roots, curriculum.today),
    curMode: canEditCurriculumOf({ myPermissions: curriculum.myPermissions, me: detail.me }) ? initialMode : "view",
    ...(focusLeaf ? goLeafPatch(focusLeaf) : {}),
    ...itemInit,
  });
  const [toast, setToast] = useState<ToastMsg>(null);
  const update = useCallback((patch: Patch) => setS((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) })), []);
  const today = cur.today;
  // 편집 패널의 미저장 수정은 커리큘럼 탭에서만 보인다 — 다른 탭·개요는 저장된 값만 (Q2-05)
  const tree = useMemo(() => buildTree(cur, S.ov, today), [cur, S.ov, today]);
  const savedOv = useMemo(() => stripFieldOv(S.ov), [S.ov]);
  const savedTree = useMemo(() => buildTree(cur, savedOv, today), [cur, savedOv, today]);
  const room = useMemo(() => toStudyRoom(detail, savedTree, today, me?.id ?? ""), [detail, savedTree, today, me]);
  const groups = useMemo(() => toSidebarGroups(studies, today), [studies, today]);
  const goLeaf = useCallback((id: string) => update(goLeafPatch(id)), [update]);
  const api = useCurriculumApi(detail.slug, setCur, update, setToast);
  const closeToast = useCallback(() => setToast(null), []);

  // 편집 화면·보기 상세(?item=) ↔ 주소 동기화 — 열면 push(뒤로 가기 = 목록), 닫으면 쌓았던 기록을 back. 새로고침하면 다시 열린다.
  // 같은 항목의 보기↔편집 전환은 replace (주소의 mode 가 화면과 어긋나지 않게)
  const editOpen = canEdit && S.tab === "curriculum" && S.curMode === "edit" && findNode(tree.nodes, S.editSel) ? S.editSel : null;
  const viewOpen = S.tab === "curriculum" && !(canEdit && S.curMode === "edit") && findNode(tree.nodes, S.viewSel) ? S.viewSel : null;
  const openItem = editOpen ?? viewOpen;
  const openMode: CurMode = editOpen ? "edit" : "view";
  // pushed: 지금 주소의 편집 기록을 이 화면이 목록 기록 위에 쌓았는지 — history.state 는 Next 라우터가 갈아 끼우므로 메모리에 둔다.
  // 새로고침으로 바로 열린 편집 화면은 아래가 목록이라는 보장이 없어 back 대신 replace 로 닫는다
  const pushed = useRef<string | null>(null);
  useEffect(() => {
    const url = readItem(window.location.search);
    const step = syncStep(url, readMode(window.location.search), openItem, openMode, url !== null && pushed.current === url);
    const href = withItem(window.location.href, openItem, openMode);
    if (step === "push") window.history.pushState(null, "", href);
    else if (step === "replace") window.history.replaceState(null, "", href);
    else if (step === "back") window.history.back();
    if (step !== "none") pushed.current = step === "push" || (step === "replace" && pushed.current) ? openItem : null;
  }, [openItem, openMode]);
  // 브라우저 뒤로·앞으로 → 주소의 항목을 연다/닫는다. 미저장 수정이 있으면 주소를 되돌려 놓고 먼저 묻는다 (조용히 버리지 않는다)
  const live = useRef({ S, tree, openItem, canEdit });
  useEffect(() => {
    live.current = { S, tree, openItem, canEdit };
  });
  useEffect(() => {
    const onPop = () => {
      const { S: s, tree: t, openItem: open, canEdit: ce } = live.current;
      const url = readItem(window.location.search);
      const target = itemFromUrl(window.location.search, (id) => !!findNode(t.nodes, id), ce);
      // 앞으로 가기로 돌아온 기록의 항목이 그새 삭제됐으면 주소에서도 지운다
      if (url && !target.id) window.history.replaceState(null, "", withItem(window.location.href, null));
      if (target.id === open && (target.id === null || (target.mode === "edit") === (s.curMode === "edit"))) return;
      if (s.curMode === "edit" && open && isDirty(s.ov, s.editSel)) {
        window.history.pushState(null, "", withItem(window.location.href, open, "edit"));
        pushed.current = open;
        // 목록(편집 모드)·다른 편집 항목은 sel, 보기 상세는 mode 전환으로 보류
        update({ leave: target.id === null || target.mode === "edit" ? { sel: target.id } : { mode: "view" }, confirm: false });
        return;
      }
      // 앞으로 가기로 연 기록은 목록 기록 위에 있다 → 닫을 때 back
      pushed.current = target.id;
      update(
        target.id === null
          ? { editSel: null, viewSel: null, confirm: false, leave: null, saved: "" }
          : target.mode === "edit"
            ? { tab: "curriculum", curMode: "edit", editSel: target.id, viewSel: null, confirm: false, leave: null, saved: "" }
            : { tab: "curriculum", curMode: "view", viewSel: target.id, editSel: null, confirm: false, leave: null, saved: "" },
      );
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [update]);

  // 참가 취소(모집 기간) · 신청 취소(승인 대기) — 확인 대화상자 + 처리 중 가드 (Q1-01, Q1-12)
  const [confirm, setConfirm] = useState<"leave" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const runCancel = async (kind: "leave" | "cancel") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await (kind === "leave" ? leaveRoom(detail.slug) : cancelApplication(detail.slug));
      setConfirm(null);
      setToast({ text: kind === "leave" ? "참가를 취소했어요 · 방 화면으로 이동해요" : "신청을 취소했어요 · 방 화면으로 이동해요", tone: "ok" });
      // 더 이상 내 스터디 대상이 아니다 — 토스트를 읽을 틈을 두고 공개 방 화면으로
      setTimeout(() => router.replace(routes.room(detail.slug)), 1500);
    } catch (e) {
      busyRef.current = false;
      setBusy(false);
      setConfirm(null);
      setToast({ text: toApiError(e).message, tone: "bad" });
    }
  };

  // "내 과제 보기" → 보드 탭으로 바꾼 뒤 탭 목록이 보이게 (Q3-18)
  const [tabJump, setTabJump] = useState(0);
  useEffect(() => {
    if (tabJump) document.getElementById("my-study-tabs")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [tabJump]);

  return (
    <TodayProvider today={today}>
      {/* 한 페이지 스크롤 — 화면 높이에 가두지 않고 카드는 내용만큼 자라며 문서 하나가 스크롤된다(편집 화면의 저장 막대는 화면 위에 붙는다).
          옆 목록은 화면에 다 들어갈 때만 붙는다(useStickyFit) */}
      <div className="flex min-h-screen flex-col p-4">
        <AppHeader active="myStudy" variant="card" bell={<NotificationBell />} />
        <div className="mx-auto flex w-full max-w-[1408px] flex-1 items-start gap-4 max-[901px]:flex-wrap">
          <StudySidebar selected={detail.slug} groups={groups} collapsed={openItem !== null} />
          <main className="min-w-0 flex-[999_1_640px] self-stretch rounded-[20px] bg-surface px-7 pb-9 pt-7 max-[901px]:px-4">
            {/* 참가 정보 카드가 아래로 떨어지는 폭(<788)은 JoinInfoCard 가 컨테이너 쿼리로 처리한다 */}
            <div className="flex flex-wrap items-start gap-7 @container">
              <section aria-label="스터디 정보" className="min-w-0 flex-[999_1_460px]">
                <StudyHeaderInfo room={room} tab={S.tab} onTab={(t) => update({ tab: t, calPick: null })} />
                {S.tab === "overview" && <OverviewTab room={room} tree={savedTree} onGoCurriculum={() => update({ tab: "curriculum" })} />}
                {S.tab === "curriculum" && <CurriculumTab tree={tree} S={S} update={update} api={api} canEdit={canEdit} isLeader={isLeader} period={{ start: detail.startDate, end: detail.endDate }} />}
                {S.tab === "board" && <BoardTab tree={savedTree} S={S} update={update} goLeaf={goLeaf} />}
                {S.tab === "calendar" && <CalendarTab tree={savedTree} S={S} update={update} goLeaf={goLeaf} />}
                {S.tab === "gantt" && <GanttTab tree={savedTree} S={S} update={update} goLeaf={goLeaf} />}
              </section>
              {S.tab === "overview" && (
                <JoinInfoCard
                  room={room}
                  tree={savedTree}
                  onMyTasks={() => {
                    update({ tab: "board", bMode: "mine", calPick: null });
                    setTabJump((n) => n + 1);
                  }}
                  goLeaf={goLeaf}
                  onCancel={setConfirm}
                  busy={busy}
                  admin={isLeader ? <><LeaderPanel detail={detail} toast={setToast} /><MemberAdminCard slug={detail.slug} members={detail.members} meId={me?.id ?? ""} toast={setToast} /></> : undefined}
                />
              )}
            </div>
          </main>
        </div>
        <Toast msg={toast} onClose={closeToast} />
        <ConfirmDialog
          open={confirm !== null}
          title={confirm === "leave" ? "참가를 취소할까요?" : "신청을 취소할까요?"}
          body={confirm === "leave" ? "모집 기간에는 다시 참가할 수 있어요. 지정 과제 담당에서도 빠져요." : "취소해도 모집 중이면 다시 신청할 수 있어요."}
          confirmLabel={confirm === "leave" ? "참가 취소" : "신청 취소"}
          danger
          busy={busy}
          onConfirm={() => confirm && void runCancel(confirm)}
          onCancel={closeConfirm}
        />
      </div>
    </TodayProvider>
  );
}
