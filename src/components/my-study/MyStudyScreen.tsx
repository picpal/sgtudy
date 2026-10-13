"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { toSidebarGroups, toStudyRoom } from "@/lib/api/my-study";
import { cancelApplication, leaveRoom } from "@/lib/api/room-view";
import type { Curriculum, MeStudies, RoomDetail } from "@/lib/api/types";
import { useMe } from "@/lib/me";
import { routes } from "@/lib/routes";
import { TodayProvider } from "@/lib/today";
import { buildTree, stripFieldOv } from "./model";
import { INITIAL_STATE, goLeafPatch, type CurMode, type Patch, type ScreenState } from "./state";
import { StudySidebar } from "./StudySidebar";
import { StudyHeaderInfo, type TabId } from "./StudyHeaderInfo";
import { OverviewTab } from "./tabs/OverviewTab";
import { JoinInfoCard } from "./tabs/JoinInfoCard";
import { CurriculumTab } from "./tabs/CurriculumTab";
import { BoardTab } from "./tabs/BoardTab";
import { CalendarTab } from "./tabs/CalendarTab";
import { GanttTab } from "./tabs/GanttTab";
import { useCurriculumApi } from "./useCurriculumApi";

type Props = { detail: RoomDetail; curriculum: Curriculum; studies: MeStudies; initialTab?: TabId; initialMode?: CurMode; initialLeaf?: string };

export function MyStudyScreen({ detail, curriculum, studies, initialTab = "overview", initialMode = "view", initialLeaf }: Props) {
  const me = useMe();
  const router = useRouter();
  const isLeader = detail.me?.state === "leader";
  const [cur, setCur] = useState(curriculum);
  // 알림 링크 ?task={nodeId}(D8): 그 리프가 이 방 커리큘럼에 있으면 커리큘럼 탭 + 리프 열림으로 시작(goLeafPatch 가 tab 을 curriculum 으로 바꾼다)
  const focusLeaf = initialLeaf && curriculum.nodes.some((n) => n.id === initialLeaf && n.task) ? initialLeaf : null;
  const [S, setS] = useState<ScreenState>({
    ...INITIAL_STATE,
    tab: initialTab,
    curMode: isLeader ? initialMode : "view",
    ...(focusLeaf ? goLeafPatch(focusLeaf) : {}),
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
      <div className="flex h-screen flex-col p-4 max-[900px]:h-auto max-[900px]:min-h-screen">
        <AppHeader active="myStudy" variant="card" bell={<NotificationBell />} />
        <div className="mx-auto flex min-h-0 w-full max-w-[1408px] flex-1 items-stretch gap-4 max-[900px]:flex-wrap">
          <StudySidebar selected={detail.slug} groups={groups} />
          <main className="thin-scroll min-h-0 min-w-0 flex-[999_1_640px] overflow-y-auto rounded-[20px] bg-surface px-7 pb-9 pt-7 max-[900px]:overflow-visible max-[900px]:px-4">
            <div className="flex flex-wrap items-start gap-7">
              <section aria-label="스터디 정보" className="min-w-0 flex-[999_1_460px]">
                <StudyHeaderInfo room={room} tab={S.tab} onTab={(t) => update({ tab: t, calPick: null })} />
                {S.tab === "overview" && <OverviewTab room={room} tree={savedTree} onGoCurriculum={() => update({ tab: "curriculum" })} />}
                {S.tab === "curriculum" && <CurriculumTab tree={tree} S={S} update={update} api={api} canEdit={isLeader} period={{ start: detail.startDate, end: detail.endDate }} />}
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
