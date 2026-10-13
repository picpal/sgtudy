"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { toSidebarGroups, toStudyRoom } from "@/lib/api/my-study";
import { cancelApplication } from "@/lib/api/room-view";
import type { Curriculum, MeStudies, RoomDetail } from "@/lib/api/types";
import { useMe } from "@/lib/me";
import { TodayProvider } from "@/lib/today";
import { buildTree } from "./model";
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
  const tree = useMemo(() => buildTree(cur, S.ov, today), [cur, S.ov, today]);
  const room = useMemo(() => toStudyRoom(detail, tree, today, me?.id ?? ""), [detail, tree, today, me]);
  const groups = useMemo(() => toSidebarGroups(studies, today), [studies, today]);
  const goLeaf = useCallback((id: string) => update(goLeafPatch(id)), [update]);
  const api = useCurriculumApi(detail.slug, setCur, update, setToast);
  const closeToast = useCallback(() => setToast(null), []);

  const cancelPending = async () => {
    try {
      await cancelApplication(detail.slug);
      setToast({ text: "신청을 취소했어요", tone: "ok" });
      router.refresh();
    } catch (e) {
      setToast({ text: toApiError(e).message, tone: "bad" });
    }
  };

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
                {S.tab === "overview" && <OverviewTab room={room} tree={tree} onGoCurriculum={() => update({ tab: "curriculum" })} />}
                {S.tab === "curriculum" && <CurriculumTab tree={tree} S={S} update={update} api={api} canEdit={isLeader} />}
                {S.tab === "board" && <BoardTab tree={tree} S={S} update={update} goLeaf={goLeaf} />}
                {S.tab === "calendar" && <CalendarTab tree={tree} S={S} update={update} goLeaf={goLeaf} />}
                {S.tab === "gantt" && <GanttTab tree={tree} S={S} update={update} goLeaf={goLeaf} />}
              </section>
              {S.tab === "overview" && <JoinInfoCard room={room} tree={tree} onMyTasks={() => update({ tab: "board", bMode: "mine", calPick: null })} goLeaf={goLeaf} onCancelPending={cancelPending} />}
            </div>
          </main>
        </div>
        <Toast msg={toast} onClose={closeToast} />
      </div>
    </TodayProvider>
  );
}
