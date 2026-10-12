"use client";

import { useCallback, useMemo, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { PLANS, ROOMS, type RoomId } from "@/data/my-study";
import { buildTree } from "./model";
import { INITIAL_STATE, goLeafPatch, type Patch, type ScreenState } from "./state";
import { StudySidebar } from "./StudySidebar";
import { StudyHeaderInfo } from "./StudyHeaderInfo";
import { OverviewTab } from "./tabs/OverviewTab";
import { JoinInfoCard } from "./tabs/JoinInfoCard";
import { CurriculumTab } from "./tabs/CurriculumTab";
import { BoardTab } from "./tabs/BoardTab";
import { CalendarTab } from "./tabs/CalendarTab";
import { GanttTab } from "./tabs/GanttTab";

export function MyStudyScreen({ roomId }: { roomId: RoomId }) {
  const room = ROOMS[roomId];
  const [S, setS] = useState<ScreenState>(INITIAL_STATE);
  const update = useCallback((patch: Patch) => setS((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) })), []);
  const tree = useMemo(() => buildTree(PLANS[roomId], S.ov), [roomId, S.ov]);
  const goLeaf = useCallback((id: string) => update(goLeafPatch(id)), [update]);

  return (
    <div className="flex h-screen flex-col p-4 max-[900px]:h-auto max-[900px]:min-h-screen">
      <AppHeader active="myStudy" variant="card" />
      <div className="mx-auto flex min-h-0 w-full max-w-[1408px] flex-1 items-stretch gap-4 max-[900px]:flex-wrap">
        <StudySidebar selected={roomId} />
        <main className="thin-scroll min-h-0 min-w-0 flex-[999_1_640px] overflow-y-auto rounded-[20px] bg-surface px-7 pb-9 pt-7 max-[900px]:overflow-visible max-[900px]:px-4">
          <div className="flex flex-wrap items-start gap-7">
            <section aria-label="스터디 정보" className="min-w-0 flex-[999_1_460px]">
              <StudyHeaderInfo room={room} tab={S.tab} onTab={(t) => update({ tab: t, calPick: null })} />
              {S.tab === "overview" && <OverviewTab room={room} tree={tree} onGoCurriculum={() => update({ tab: "curriculum" })} />}
              {S.tab === "curriculum" && <CurriculumTab tree={tree} S={S} update={update} />}
              {S.tab === "board" && <BoardTab tree={tree} S={S} update={update} goLeaf={goLeaf} />}
              {S.tab === "calendar" && <CalendarTab tree={tree} S={S} update={update} goLeaf={goLeaf} />}
              {S.tab === "gantt" && <GanttTab tree={tree} S={S} update={update} goLeaf={goLeaf} />}
            </section>
            {S.tab === "overview" && <JoinInfoCard room={room} tree={tree} onMyTasks={() => update({ tab: "board", bMode: "mine", calPick: null })} goLeaf={goLeaf} />}
          </div>
        </main>
      </div>
    </div>
  );
}
