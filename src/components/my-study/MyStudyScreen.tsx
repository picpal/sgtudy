"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LeaderPanel } from "@/components/room-view/LeaderPanel";
import { AppHeader } from "@/components/ui/AppHeader";
import { PageBody } from "@/components/ui/PageBody";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { MoreMenuItem } from "@/components/ui/MoreMenu";
import { cancelConfirmBody, menuItemsOf, studyMoreItems } from "@/components/room-view/moreItems";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { canEditCurriculumOf, toSidebarGroups, toStudyRoom } from "@/lib/api/my-study";
import { cancelApplication, leaveRoom } from "@/lib/api/room-view";
import { cancelLeaveRequest, leaveErrorText, requestLeave } from "@/lib/api/leave";
import type { Curriculum, MeStudies, Notice, RoomDetail } from "@/lib/api/types";
import { useMe } from "@/lib/me";
import { routes } from "@/lib/routes";
import { setScreenKey } from "@/lib/leaveGuard";
import { clearTaskOrigin, taskOriginOf } from "@/lib/taskOrigin";
import { COMMENT_HASH_PREFIX, OVERVIEW_ANCHORS, peekHashPrefix, useHashAnnounce, useItemAnnounce, useTabAnnounce, useTaskAnnounce } from "@/lib/hashTarget";
import { fetchNoticeInbox } from "@/lib/api/notices";
import { useRefetchOnFocus } from "@/lib/useRefetchOnFocus";
import { TodayProvider } from "@/lib/today";
import { itemFromUrl, readItem, readMode, syncStep, withItem } from "./editUrl";
import { EMPTY_OVERRIDES, buildTree, findNode, isPersonal, stripFieldOv, thisRoundId } from "./model";
import { currentRoundId, roundsOutsidePeriod } from "./rounds";
import { INITIAL_STATE, SHOW_OTHERS_PATCH, blocksLeave, editUnsaved, goLeafPatch, modeSwitchPatch, tabPatch, viewBackPatch, type CurMode, type Patch, type ScreenState } from "./state";
import { StudySidebar } from "./StudySidebar";
import { StudyHeaderInfo, type TabId } from "./StudyHeaderInfo";
import { OverviewTab } from "./tabs/OverviewTab";
import { PeriodWarning } from "./tabs/PeriodWarning";
import { JoinInfoCard, type JoinCardAction } from "./tabs/JoinInfoCard";
import { ReasonField } from "@/components/ui/ReasonField";
import { CurriculumTab } from "./tabs/CurriculumTab";
import { BoardTab } from "./tabs/BoardTab";
import { CalendarTab } from "./tabs/CalendarTab";
import { MemberAdminCard } from "./tabs/MemberAdminCard";
import { GanttTab } from "./tabs/GanttTab";
import { NoticeTab, type NoticeViewer } from "./tabs/NoticeTab";
import { NoticePopup } from "./NoticePopup";
import { useCurriculumApi } from "./useCurriculumApi";
import { RoomArchivedProvider } from "./roomArchived";
import { SubmitSlotProvider } from "./submitSlot";
import { progressChangedSince, progressScope } from "@/lib/progressStale";

const CONFIRM_TEXT: Record<JoinCardAction, { title: string; body: string; label: string }> = {
  leave: { title: "참가를 취소할까요?", body: "모집 기간에는 다시 참가할 수 있어요. 지정 과제 담당에서도 빠져요.", label: "참가 취소" },
  cancel: { title: "신청을 취소할까요?", body: cancelConfirmBody(false), label: "신청 취소" }, // 보관된 방은 아래에서 cancelConfirmBody(true)
  leaveRequest: {
    title: "그룹장에게 탈퇴를 요청할까요?",
    body: "그룹장이 맡은 과제를 다른 팀원에게 넘긴 뒤 처리해요. 처리되기 전에는 요청을 취소할 수 있고, 지금까지 낸 제출 기록은 남아요.",
    label: "탈퇴 요청",
  },
  leaveRequestCancel: { title: "탈퇴 요청을 취소할까요?", body: "취소하면 지금처럼 계속 참가해요.", label: "요청 취소" },
};

type Props = { detail: RoomDetail; curriculum: Curriculum; studies: MeStudies; initialTab?: TabId; initialMode?: CurMode; initialLeaf?: string; initialItem?: string };

/** 개인 목표 id 인가 — 편집 화면 대상이 아니다(편집 URL 로 와도 보기 상세) */
const isPersonalId = (nodes: Curriculum["nodes"], id: string) => nodes.some((n) => n.id === id && n.task?.type === "personal");

// 목록 주소(항목 없음)의 ?tab= 을 화면 탭에 맞춘다 — 항목이 열린 주소는 건드리지 않는다
function syncListTab(tab: TabId) {
  const sp = new URLSearchParams(window.location.search);
  if (readItem(window.location.search) !== null || (sp.get("tab") ?? "overview") === tab) return;
  const u = new URL(window.location.href);
  u.searchParams.set("tab", tab);
  window.history.replaceState(null, "", `${u.pathname}?${u.searchParams.toString()}${u.hash}`);
}

export function MyStudyScreen({ detail, curriculum, studies, initialTab = "overview", initialMode = "view", initialLeaf, initialItem }: Props) {
  const me = useMe();
  const router = useRouter();
  const isLeader = detail.me?.state === "leader";
  const [cur, setCur] = useState(curriculum);
  // 본문 카드 아래 「과제 제출」 카드 자리 — 붙으면(콜백 ref) 상세가 그 안으로 포털한다
  const [submitSlot, setSubmitSlot] = useState<HTMLDivElement | null>(null);
  // 커리큘럼 편집 — 그룹장 + 그룹장이 권한을 준 팀원. node_* 응답의 myPermissions 로 갱신된다(거둬지면 false)
  const canEdit = canEditCurriculumOf({ myPermissions: cur.myPermissions, me: detail.me });
  // 알림 링크 ?task={nodeId}(D8): 그 리프가 이 방 커리큘럼에 있으면 커리큘럼 탭 + 리프 열림으로 시작(goLeafPatch 가 tab 을 curriculum 으로 바꾼다)
  const focusLeaf = initialLeaf && curriculum.nodes.some((n) => n.id === initialLeaf && n.task) ? initialLeaf : null;
  // ?item=: 새로고침하면 같은 화면 — 편집 권한 + mode=edit 이면 편집 화면, 아니면 보기 상세. 없는 id 면 목록 — 아래 URL 동기화가 주소에서 지운다
  const itemInit: Partial<ScreenState> =
    !focusLeaf && initialItem && curriculum.nodes.some((n) => n.id === initialItem)
      ? canEditCurriculumOf({ myPermissions: curriculum.myPermissions, me: detail.me }) && initialMode === "edit" && !isPersonalId(curriculum.nodes, initialItem)
        ? { tab: "curriculum", curMode: "edit", editSel: initialItem }
        : { tab: "curriculum", curMode: "view", viewSel: initialItem }
      : {};
  const [S, setS] = useState<ScreenState>({
    ...INITIAL_STATE,
    tab: initialTab,
    // 보드는 스프린트 보드처럼 현재 회차로 시작 (칩으로 "전체" 선택 가능)
    bRound: currentRoundId(buildTree(curriculum, EMPTY_OVERRIDES, curriculum.today).roots, curriculum.today),
    curMode: canEditCurriculumOf({ myPermissions: curriculum.myPermissions, me: detail.me }) ? initialMode : "view",
    // 내 과제·내 일정의 과제 링크로 들어왔으면 상세의 [← 내 과제] 가 그 화면으로 — 그 링크가 이 화면 기록을 출발지 기록 바로 위에 쌓았다.
    // 기억은 클라이언트 이동에만 있다(전체 불러오기는 서버·브라우저 모두 null 이라 하이드레이션이 어긋나지 않는다).
    // 댓글 딥링크(#comment-{id})면 제출 영역으로 끌어가지 않는다(D16①) — viewFocus 는 effect 에서만 쓰여 마크업이 서버와 같다
    ...(focusLeaf
      ? typeof window === "undefined"
        ? goLeafPatch(focusLeaf)
        : goLeafPatch(focusLeaf, taskOriginOf(routes.myStudy(detail.slug), focusLeaf), peekHashPrefix(COMMENT_HASH_PREFIX))
      : {}),
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
  // 연 곳 = 지금 탭 — 상세의 [← 보드] 와 브라우저 뒤로 가기(아래 backTab)가 같은 탭으로 돌아간다
  const goLeaf = useCallback((id: string) => update((p) => goLeafPatch(id, p.tab)), [update]);
  // 이 화면의 key(page.tsx: task·tab) — 이탈 가드가 "같은 화면 주소" 를 같은 규칙으로 판정한다 (E 리뷰 minor 1)
  useEffect(() => setScreenKey({ tab: initialTab, task: initialLeaf ?? "" }), [initialTab, initialLeaf]);
  const api = useCurriculumApi(detail.slug, setCur, update, setToast, detail.me);
  // 브라우저 뒤로·앞으로 가기로 되살아난 화면은 그때의 서버 props(커리큘럼·방 정보)로 시작한다 — 그 뒤 제출·완료가 있었으면 한 번 다시 받는다
  useEffect(() => {
    if (!progressChangedSince(progressScope.room(detail.slug))) return;
    void api.refresh();
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트 때 한 번
  }, []);
  // 같은 화면에서 알림(#applications · #leave-requests)을 누르면 Next 는 화면을 그대로 둔다 — 다른 탭에 있었으면 개요로 (시나리오 QA #8)
  const onAnnounce = useCallback(
    (h: string) => (OVERVIEW_ANCHORS as readonly string[]).includes(h) && update((p) => tabPatch(p, "overview", canEdit)),
    [update, canEdit],
  );
  useHashAnnounce(onAnnounce);
  // 공지(0040) — 탭 점(D9)·진입 팝업(D5) 은 첫 페인트 뒤 notice_inbox 로 (D15). 승인 대기는 볼 수 없다(D10)
  const noticeViewer: NoticeViewer = isLeader ? "leader" : detail.me?.state === "active" ? "member" : detail.me?.state === "inactive" ? "left" : "pending";
  const [noticeUnread, setNoticeUnread] = useState(false);
  const [popups, setPopups] = useState<Notice[]>([]);
  useEffect(() => {
    if (noticeViewer === "pending") return;
    let live = true;
    fetchNoticeInbox(detail.slug)
      .then((r) => {
        if (!live) return;
        setNoticeUnread(r.unread);
        setPopups(r.popups);
      })
      .catch(() => {}); // 부가 기능 — 실패해도 화면은 그대로
    return () => {
      live = false;
    };
  }, [detail.slug, noticeViewer]);
  // 같은 화면(같은 key)에서 공지 알림을 다시 누르면 — 다른 탭을 보고 있었어도 공지 탭으로, 목록은 새로 받는다
  const [noticeReload, setNoticeReload] = useState(0);
  const onTabAnnounce = useCallback(
    (t: string) => {
      if (t !== "notice") return;
      update((p) => tabPatch(p, "notice", canEdit));
      setNoticeReload((n) => n + 1);
    },
    [update, canEdit],
  );
  useTabAnnounce(onTabAnnounce);
  // 팝업 [확인] — 탭 점, 공지 탭이 열려 있으면 그 목록의 안 읽음 표시도
  const onNoticeAck = useCallback((unread: boolean) => {
    setNoticeUnread(unread);
    setNoticeReload((n) => n + 1);
  }, []);
  // 승인 대기 중에 열어 둔 화면 — 다른 탭에서 돌아오면 다시 불러 승인(참가 확정)을 반영한다 (시나리오 QA #9)
  useRefetchOnFocus(detail.me?.state === "pending", router.refresh);
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
  // overView: 지금 편집 기록을 같은 항목의 보기 상세 기록 위에 쌓았는지 (상세 → "편집" = push, 뒤로 = 상세)
  const overView = useRef(false);
  const backTab = useRef<TabId | null>(null);
  // closedByBack: 이 화면이 상세·편집을 history.back 으로 닫았다 — 그 back 의 popstate 에서만 목록 주소 ?tab= 을 화면 탭에 맞춘다 (F 리뷰 m1)
  const closedByBack = useRef(false);
  const shownTab = useRef<TabId>(S.tab);
  // guardPop: 미저장 확인 때문에 popstate 가 되돌려 쌓은 기록 아래(뒤로 간 곳)의 항목·모드 — "버리기"로 그곳을 열면 replace 로 같은 기록을 하나 더 만들지 않고 back 으로 그 기록에 돌아간다 (재리뷰 nit)
  const guardPop = useRef<{ id: string | null; mode: CurMode } | null>(null);
  // belowView: 편집 기록 바로 아래에 있는 보기 상세 기록(상세 → "편집" 으로 쌓았다)과 그 상세 기록의 pushed — 편집 안에서 다른 항목으로 옮겨(replace) 그 위가
  // 다른 항목의 편집이 되어도 남는다. [저장] 이 그 상세로 돌아가면 replace 대신 back 해서 상세 기록이 둘이 되지 않게 한다
  const belowView = useRef<{ id: string; pushed: string | null } | null>(null);
  useEffect(() => {
    const url = readItem(window.location.search);
    const urlMode = readMode(window.location.search);
    const step = syncStep(url, urlMode, openItem, openMode, url !== null && pushed.current === url, new URLSearchParams(window.location.search).has("task"), overView.current);
    const href = withItem(window.location.href, openItem, openMode);
    const gp = guardPop.current;
    guardPop.current = null;
    const below = belowView.current;
    if (openItem === null || openMode === "view") belowView.current = null; // 편집을 닫았다
    if (step === "replace" && gp && gp.id === openItem && gp.mode === openMode) {
      // 뒤로 간 기록이 바로 아래에 있다 — 그 popstate 는 화면과 같아 따로 바꾸지 않는다. 기록 상태는 popstate 가 그 기록을 열었을 때와 같게
      closedByBack.current = true;
      window.history.back();
      pushed.current = openItem;
      overView.current = false;
      return;
    }
    if (step === "replace" && below && openMode === "view" && below.id === openItem) {
      // 편집 기록 아래가 바로 그 상세 기록 — back 으로 돌아간다. popstate 는 화면과 같아 따로 바꾸지 않는다
      closedByBack.current = true;
      window.history.back();
      pushed.current = below.pushed;
      overView.current = false;
      return;
    }
    const modePush = step === "push" && url !== null && url === openItem;
    if (modePush && openItem) belowView.current = { id: openItem, pushed: pushed.current };
    // 목록 기록 위에 상세·편집을 쌓을 때, 그 목록 기록이 보여 주던 탭(보드 카드 → 상세 등) — 뒤로 가기로 돌아오면 그 탭으로
    if (step === "push" && url === null) backTab.current = shownTab.current;
    if (step === "push") window.history.pushState(null, "", href);
    else if (step === "replace") window.history.replaceState(null, "", href);
    else if (step === "back") {
      closedByBack.current = true;
      window.history.back();
    }
    if (step === "none") return;
    // 상세 위 편집 기록을 쌓거나 걷을 때는 아래 상세 기록의 pushed 를 그대로 둔다
    if (!modePush && !(step === "back" && overView.current)) pushed.current = step === "push" || (step === "replace" && pushed.current) ? openItem : null;
    overView.current = modePush;
  }, [openItem, openMode]);
  useEffect(clearTaskOrigin, []);
  // 열린 항목이 없어지면(목록·다른 탭) 연 곳도 잊는다 — 다음 상세는 그때 연 곳을 새로 적는다 (렌더 중 맞추기 — 목록이 한 번 더 그려질 뿐)
  if (openItem === null && S.viewFrom !== null) update({ viewFrom: null });
  // 상세 [← …] — 다른 화면 출발지는 그 기록이 바로 아래 있을 때(이 화면이 위에 기록을 쌓지 않았다) 브라우저 뒤로 가기와 같게 back.
  // 방 탭 출발지는 상세를 닫고 그 탭으로 — 위 동기화 effect 가 쌓았던 상세 기록을 back 으로 걷어 브라우저 뒤로 가기와 같은 목록 기록에 선다
  const viewBack = () => {
    if ((S.viewFrom === "tasks" || S.viewFrom === "schedule") && pushed.current === null && !overView.current) window.history.back();
    else update(viewBackPatch);
  };
  // 위 동기화 effect 가 볼 "직전 렌더의 탭" — 동기화 뒤에 갱신한다
  useEffect(() => {
    shownTab.current = S.tab;
  });
  // 확인을 닫으면("계속 고치기"·폼이 깨끗해짐) 되돌려 쌓은 기록 표시도 지운다 — 위 동기화 effect 가 먼저 돌아 "버리기"는 소비한 뒤다
  useEffect(() => {
    if (!S.leave) guardPop.current = null;
  }, [S.leave]);
  // 목록 화면(항목 없음)의 ?tab= 은 지금 탭을 따라간다 — 뒤로 가기로 돌아온 기록·새로고침이 다른 탭을 열지 않게
  useEffect(() => {
    if (openItem === null) syncListTab(S.tab);
  }, [S.tab, openItem]);
  // 브라우저 뒤로·앞으로 → 주소의 항목을 연다/닫는다. 미저장 수정이 있으면 주소를 되돌려 놓고 먼저 묻는다 (조용히 버리지 않는다)
  const live = useRef({ S, tree, openItem, canEdit });
  useEffect(() => {
    live.current = { S, tree, openItem, canEdit };
  });
  const studyPath = new URL(routes.myStudy(detail.slug), "http://x").pathname;
  useEffect(() => {
    const onPop = () => {
      const { S: s, tree: t, openItem: open, canEdit: ce } = live.current;
      const ownBack = closedByBack.current;
      closedByBack.current = false;
      // 다른 화면 주소로 돌아간 기록(클라이언트 이동으로 들어온 경우)은 Next 가 그 화면을 연다 — 그 주소에 ?item= 을 쌓거나 묻지 않는다 (재리뷰 R-3)
      if (window.location.pathname !== studyPath) return;
      const url = readItem(window.location.search);
      const target = itemFromUrl(window.location.search, (id) => !!findNode(t.nodes, id), ce, (id) => {
        const n = findNode(t.nodes, id);
        return !!n && isPersonal(n);
      });
      // 앞으로 가기로 돌아온 기록의 항목이 그새 삭제됐으면 주소에서도 지운다
      if (url && !target.id) window.history.replaceState(null, "", withItem(window.location.href, null));
      if (target.id === open && (target.id === null || (target.mode === "edit") === (s.curMode === "edit"))) {
        // 화면 안 닫기(이 화면의 history.back)로 돌아온 목록 기록 — 화면은 이미 목록이고 위 탭 effect 는 다시 돌지 않는다 → 주소의 ?tab= 을 화면 탭에 맞춘다 (F 리뷰 n1).
        // 다른 목록 기록(?tab=overview → 알림으로 ?tab=curriculum → 뒤로)은 곧 다시 마운트될 화면의 것이라 건드리지 않는다 (F 리뷰 m1)
        if (target.id === null && ownBack) syncListTab(s.tab);
        return;
      }
      if (s.personalUnsaved !== null && s.personalUnsaved === open && s.curMode === "view") {
        // 개인 목표 편집 폼에 미저장 — 상세 기록을 되돌려 놓고 먼저 묻는다
        window.history.pushState(null, "", withItem(window.location.href, open, "view"));
        guardPop.current = target;
        update({ leave: { view: target.id }, confirm: false });
        return;
      }
      if (s.curMode === "edit" && open && editUnsaved(s, s.editSel)) {
        // 편집 기록을 되돌려 놓는다 — 뒤로 간 곳이 같은 항목 상세면 여전히 그 위에 쌓인 편집 기록
        const backToView = target.id === open && target.mode === "view";
        window.history.pushState(null, "", withItem(window.location.href, open, "edit"));
        if (!backToView) pushed.current = open;
        overView.current = backToView && overView.current;
        guardPop.current = target;
        // 목록(편집 모드)·다른 편집 항목은 sel, 보기 상세는 mode 전환으로 보류
        update({ leave: target.id === null || target.mode === "edit" ? { sel: target.id } : { mode: "view" }, confirm: false });
        return;
      }
      // 앞으로 가기로 연 기록은 목록 기록 위에 있다 → 닫을 때 back. 상세에서 앞으로 가기로 연 같은 항목 편집은 상세 위 기록
      overView.current = target.id !== null && target.id === open && target.mode === "edit";
      if (!overView.current) pushed.current = target.id;
      // 목록에서 앞으로 가기로 연 기록 — 연 곳은 뒤로 가기가 돌아갈 탭(backTab)과 같게. 상세 ↔ 편집 사이는 연 곳을 그대로
      const from = open === null ? backTab.current : s.viewFrom;
      update(
        target.id === null
          ? { ...(backTab.current ? { tab: backTab.current } : {}), editSel: null, editFrom: null, viewSel: null, confirm: false, leave: null, saved: "" }
          : target.mode === "edit"
            ? { tab: "curriculum", curMode: "edit", editSel: target.id, editFrom: overView.current ? { view: target.id } : "list", viewSel: null, viewFrom: from, confirm: false, leave: null, saved: "" }
            : { tab: "curriculum", curMode: "view", viewSel: target.id, viewFrom: from, editSel: null, editFrom: null, confirm: false, leave: null, saved: "" },
      );
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [update, studyPath]);
  // 같은 화면에서 ?item= 알림(묶음 일정 변경, 0028)을 누르면 key(id·task·tab)가 같아 다시 마운트되지 않는다 — 바뀐 initialItem 을 연다 (백로그 F 리뷰 I1).
  // key 에 item 을 넣지 않는다: 상세는 pushState 로 주소에 item 을 쓰므로 router.refresh 뒤 화면 상태가 날아간다.
  // 이미 열린 항목·없는 항목은 그대로. 저장 안 한 편집은 이탈 가드가 이동을 보류하므로 여기 오지 않지만, 혹시 와도 덮지 않는다.
  // 열린 기록은 알림 이동이 목록(이전) 기록 위에 쌓은 것 → popstate 분기처럼 pushed 로 두어 닫으면 back.
  // 상세 안에서 다른 항목으로 옮긴 뒤 같은 알림을 다시 누르면 initialItem 이 그대로다 → 벨이 알린 item(announceItem)을 주소가 그 item 이 된 렌더에서 연다 (재리뷰 m1).
  // 알림과 prop 변경이 같은 렌더에 오면 한 번만 연다 — 매 렌더 한 effect 에서 둘을 함께 본다
  const seenItem = useRef(initialItem);
  const askedItem = useRef<string | null>(null);
  const onItemAnnounce = useCallback((id: string) => {
    askedItem.current = id;
  }, []);
  useItemAnnounce(onItemAnnounce);
  useEffect(() => {
    const prev = seenItem.current;
    seenItem.current = initialItem;
    const url = readItem(window.location.search);
    const asked = askedItem.current !== null && askedItem.current === url;
    if (asked) askedItem.current = null;
    const id = asked ? url : initialItem && initialItem !== prev ? initialItem : null;
    if (!id) return;
    const { S: s, tree: t, openItem: open, canEdit: ce } = live.current;
    const n = findNode(t.nodes, id);
    if (!n || id === open) return;
    if (s.curMode === "edit" && open && editUnsaved(s, s.editSel)) return;
    const edit = ce && (asked ? readMode(window.location.search) : initialMode) === "edit" && !isPersonal(n);
    if (url === id) {
      pushed.current = id;
      overView.current = false;
      backTab.current = shownTab.current;
    }
    // 알림이 쌓은 기록 아래는 지금 보이던 탭 — 연 곳도 그 탭 (주소만 바뀐 경우는 모름)
    const from = url === id ? shownTab.current : null;
    update(
      edit
        ? { tab: "curriculum", curMode: "edit", editSel: id, editFrom: "list", viewSel: null, viewFrom: from, confirm: false, leave: null, saved: "" }
        : { tab: "curriculum", curMode: "view", viewSel: id, viewFrom: from, editSel: null, confirm: false, leave: null, saved: "" },
    );
  });

  // 같은 과제 화면(key 의 task 가 같다)에서 그 과제 알림(댓글 멘션 등)을 다시 누르면 다시 마운트되지 않는다 — 다른 탭·항목을 보고 있었으면
  // 주소가 그 ?task= 가 된 렌더에서 그 과제 상세를 연다(?item=·공지 탭 알림과 같은 길). 다른 과제는 key 가 바뀌어 새로 마운트된다.
  // 저장하지 않은 수정이 있으면 덮지 않는다
  const askedTask = useRef<string | null>(null);
  const onTaskAnnounce = useCallback(
    (t: string) => {
      if (t === initialLeaf) askedTask.current = t;
    },
    [initialLeaf],
  );
  useTaskAnnounce(onTaskAnnounce);
  useEffect(() => {
    const t = askedTask.current;
    if (!t || new URLSearchParams(window.location.search).get("task") !== t) return;
    askedTask.current = null;
    const { S: s, tree: tr, openItem: open, canEdit: ce } = live.current;
    if (open === t || !findNode(tr.nodes, t) || blocksLeave(s, ce)) return;
    update(goLeafPatch(t, null, peekHashPrefix(COMMENT_HASH_PREFIX)));
  });

  // 새로고침·링크로 바로 열린 편집 화면은 아래 기록이 목록이 아니다 — 수정을 시작하면 지금 기록을 목록으로 바꾸고 편집 기록을 쌓아,
  // 브라우저 뒤로 가기가 다른 화면으로 조용히 떠나지 않고 위 popstate 의 "저장하지 않은 수정" 확인을 거치게 한다 (Q2-1)
  const editDirty = !!editOpen && editUnsaved(S, editOpen);
  useEffect(() => {
    if (!editDirty || !editOpen || pushed.current === editOpen || overView.current) return;
    window.history.replaceState(null, "", withItem(window.location.href, null));
    window.history.pushState(null, "", withItem(window.location.href, editOpen, "edit"));
    pushed.current = editOpen;
    backTab.current = "curriculum";
  }, [editDirty, editOpen]);
  // "회차 추가" 로 만든 뒤 한 번도 저장하지 않고 편집 화면을 떠나면(목록·다른 항목·탭·모드) 빈 회차를 남기지 않는다 (Q2-8).
  // 과제를 하나라도 넣었으면 그대로 둔다. 다른 화면 주소로 떠나는 경우는 편집 화면(leaveGuard)이 맡는다
  const prevEdit = useRef<string | null>(editOpen);
  useEffect(() => {
    const prev = prevEdit.current;
    prevEdit.current = editOpen;
    if (!prev || prev === editOpen || S.fresh !== prev) return;
    update({ fresh: null });
    const n = findNode(tree.nodes, prev);
    if (n && !n.leaf && !n.temp && n.kids.every(isPersonal)) void api.remove(prev, "child", "저장하지 않은 새 회차는 지웠어요");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 열린 편집 항목이 바뀔 때만
  }, [editOpen]);

  // 참가 취소(모집 기간) · 신청 취소(승인 대기) · 탈퇴 요청/요청 취소(진행 중, D3) — 확인 대화상자 + 처리 중 가드 (Q1-01, Q1-12)
  const [confirm, setConfirmRaw] = useState<JoinCardAction | null>(null);
  const [reason, setReason] = useState("");
  const setConfirm = useCallback((k: JoinCardAction | null) => {
    setConfirmRaw(k);
    if (k === "leaveRequest") setReason("");
  }, []);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const closeConfirm = useCallback(() => setConfirmRaw(null), []);
  // 탈퇴 요청·취소는 이 화면에 그대로 남는다 — 서버 값으로 다시 그린다(참가 카드·더보기)
  const runLeaveRequest = async (kind: "leaveRequest" | "leaveRequestCancel") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await (kind === "leaveRequest" ? requestLeave(detail.slug, reason) : cancelLeaveRequest(detail.slug));
      setToast({ text: kind === "leaveRequest" ? "탈퇴를 요청했어요 · 그룹장이 처리하면 알려 드려요" : "탈퇴 요청을 취소했어요 · 계속 참가해요", tone: "ok" });
      router.refresh();
    } catch (e) {
      const err = toApiError(e);
      setToast({ text: leaveErrorText(err.code, err.message), tone: "bad" });
      router.refresh();
    } finally {
      busyRef.current = false;
      setBusy(false);
      setConfirmRaw(null);
    }
  };
  const runCancel = async (kind: JoinCardAction) => {
    if (kind === "leaveRequest" || kind === "leaveRequestCancel") return runLeaveRequest(kind);
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

  // 공유: 공개 방 주소를 복사한다 (내 스터디 주소는 참가자만 열 수 있다 — 지금 주소 창의 주소를 대신 안내하지 않는다)
  const share = async () => {
    try {
      await navigator.clipboard.writeText(new URL(routes.room(detail.slug), window.location.origin).href);
      setToast({ text: "링크를 복사했어요", tone: "ok" });
    } catch {
      setToast({ text: "링크를 복사하지 못했어요 · 홈에서 방 카드를 눌러 방 화면의 주소를 복사해 주세요", tone: "bad" });
    }
  };
  // 더보기: 방 설정(그룹장) · 참가/신청 취소 · 탈퇴 요청/요청 취소 (참가 카드와 같은 확인 대화상자)
  const more: MoreMenuItem[] = menuItemsOf(studyMoreItems(room.action, { canRequestLeave: room.action === "joined", leaveRequested: !!room.leaveRequest }), detail.slug, setConfirm, routes.myStudyTab(detail.slug, S.tab));

  // "내 과제 보기" → 보드 탭으로 바꾼 뒤 탭 목록이 보이게 (Q3-18)
  const [tabJump, setTabJump] = useState(0);
  useEffect(() => {
    if (tabJump) document.getElementById("my-study-tabs")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [tabJump]);
  // 개요 멤버 관리 "팀원 개인 목표 보기 →" — 열린 상세를 닫고 진행목표 보기 목록 + 팀원 목표 칩
  const showOthers = () => {
    update(SHOW_OTHERS_PATCH);
    setTabJump((n) => n + 1);
  };
  // 방 기간을 벗어난 일정 — 개요·진행목표 경고 줄. 종료·보관된 방은 고칠 수 없어 보이지 않는다
  // 서버가 준 노드(cur.nodes) 기준 — 화면 필터·편집 중 미저장 수정과 무관 (서버 PERIOD_OUTSIDE_ROOM·room_update 규칙과 같은 입력)
  const periodStatus = detail.archived || detail.status === "ended" ? null : detail.status;
  const gap = useMemo(() => (periodStatus ? roundsOutsidePeriod(cur.nodes, { start: detail.startDate, end: detail.endDate }) : null), [periodStatus, detail.startDate, detail.endDate, cur.nodes]);
  const periodWarning = (onEditRounds?: () => void) =>
    gap && periodStatus && <PeriodWarning gap={gap} slug={detail.slug} roomStatus={periodStatus} canEdit={canEdit} isLeader={isLeader} onEditRounds={onEditRounds} toast={setToast} />;
  const editRounds = async () => {
    if (!(await api.recheckEdit())) return; // 권한 재확인 (시나리오 QA #10)
    update((p) => ({ tab: "curriculum", ...modeSwitchPatch({ ...p, viewSel: null }, "edit") }));
    setTabJump((n) => n + 1);
  };
  // 개인 목표 "이번 회차" — /tasks(me_tasks cur)와 같은 규칙. /tasks 처럼 모집·진행 중인 방만
  const personalRoundId = !detail.archived && (detail.status === "recruit" || detail.status === "active") ? thisRoundId(savedTree.roots, today) : null;

  return (
    <TodayProvider today={today}>
      <RoomArchivedProvider value={detail.archived}>
      {/* 한 페이지 스크롤 — 화면 높이에 가두지 않고 카드는 내용만큼 자라며 문서 하나가 스크롤된다(편집 화면의 저장 막대는 화면 위에 붙는다).
          옆 목록은 화면에 다 들어갈 때만 붙는다(useStickyFit) */}
      <div className="flex min-h-screen flex-col">
        <AppHeader active="myStudy" bell={<NotificationBell />} />
        <PageBody>
          {/* ≤900 content-start: 내용이 화면보다 짧을 때 줄바꿈된 줄들이 남는 높이를 나눠 갖지 않게 — 접힌 목록 아래 빈 공간 방지 */}
          <div className="flex w-full flex-1 items-start gap-4 max-[901px]:flex-wrap max-[901px]:content-start">
            <StudySidebar selected={detail.slug} groups={groups} collapsed={openItem !== null} />
            {/* 본문 카드 + 그 아래 형제 카드 자리(과제 상세의 「과제 제출」·「시험 응시」 — submitSlot). 둘 다 main 안이라 랜드마크는 하나 */}
            <main className="flex min-w-0 flex-[999_1_640px] flex-col gap-4 self-stretch">
              <SubmitSlotProvider value={submitSlot}>
                <div className="min-w-0 flex-1 rounded-[20px] bg-surface px-7 pb-9 pt-7 max-[901px]:px-4 max-sm:pb-7 max-sm:pt-5">
                  {/* 참가 정보 카드가 아래로 떨어지는 폭(<788)은 JoinInfoCard 가 컨테이너 쿼리로 처리한다 */}
                  <div className="flex flex-wrap items-start gap-7 @container">
                    <section aria-label="스터디 정보" className="min-w-0 flex-[999_1_460px]">
                      <StudyHeaderInfo room={room} tab={S.tab} onTab={(t) => update((p) => tabPatch(p, t, canEdit))} onShare={share} more={more} noticeUnread={noticeUnread} />
                      {S.tab === "overview" && <OverviewTab room={room} tree={savedTree} roundId={personalRoundId} today={today} onGoCurriculum={() => update({ tab: "curriculum" })} onOpenTask={goLeaf} periodWarning={periodWarning(editRounds)} />}
                      {S.tab === "notice" && <NoticeTab slug={detail.slug} S={S} update={update} viewer={noticeViewer} ended={detail.status === "ended"} onUnread={setNoticeUnread} toast={setToast} reload={noticeReload} />}
                      {S.tab === "curriculum" && <CurriculumTab tree={tree} S={S} update={update} onViewBack={viewBack} api={api} canEdit={canEdit} isLeader={isLeader} period={{ start: detail.startDate, end: detail.endDate }} slug={detail.slug} roomStatus={detail.archived ? "ended" : detail.status} viewerPending={detail.me?.state === "pending"} toast={setToast} personal={cur.personal} periodWarning={periodWarning} />}
                      {S.tab === "board" && <BoardTab tree={savedTree} S={S} update={update} goLeaf={goLeaf} />}
                      {S.tab === "calendar" && <CalendarTab tree={savedTree} S={S} update={update} goLeaf={goLeaf} />}
                      {S.tab === "gantt" && <GanttTab tree={savedTree} S={S} update={update} goLeaf={goLeaf} isLeader={isLeader} />}
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
                        admin={isLeader ? <><LeaderPanel detail={detail} toast={setToast} /><MemberAdminCard slug={detail.slug} members={detail.members} meId={me?.id ?? ""} toast={setToast} tree={savedTree} roundId={personalRoundId} onShowOthers={showOthers}
                          leave={detail.status === "active" && !detail.archived ? { today, leaderDoesTasks: detail.leaderDoesTasks, leaveRequestCount: detail.leaveRequestCount ?? 0 } : undefined} /></> : undefined}
                      />
                    )}
                  </div>
                </div>
              </SubmitSlotProvider>
              <div ref={setSubmitSlot} className="@container flex flex-col gap-4 empty:hidden" />
            </main>
          </div>
          <Toast msg={toast} onClose={closeToast} />
          <NoticePopup slug={detail.slug} popups={popups} hold={confirm !== null || S.leave !== null} onAck={onNoticeAck} />
          <ConfirmDialog
            open={confirm !== null}
            title={CONFIRM_TEXT[confirm ?? "leave"].title}
            body={confirm === "cancel" ? cancelConfirmBody(detail.archived) : CONFIRM_TEXT[confirm ?? "leave"].body}
            confirmLabel={CONFIRM_TEXT[confirm ?? "leave"].label}
            danger={confirm !== "leaveRequestCancel"}
            busy={busy}
            onConfirm={() => confirm && void runCancel(confirm)}
            onCancel={closeConfirm}
          >
            {confirm === "leaveRequest" && <ReasonField value={reason} onChange={setReason} label="사유 (선택)" placeholder="그룹장에게 남길 말이 있으면 적어 주세요" />}
          </ConfirmDialog>
        </PageBody>
      </div>
      </RoomArchivedProvider>
    </TodayProvider>
  );
}
