"use client";

import { useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { INITIAL_JOIN, actionOf, type JoinState, type Room, type RoomId } from "@/data/room-view";
import { RoomSidebar } from "./RoomSidebar";
import { RoomInfo } from "./RoomInfo";
import { JoinCard } from "./JoinCard";
import { GlanceCard } from "./GlanceCard";

export function RoomViewScreen({ room }: { room: Room }) {
  const [join, setJoin] = useState<Partial<Record<RoomId, JoinState>>>(INITIAL_JOIN);
  const set = (v: JoinState) => setJoin((j) => ({ ...j, [room.id]: v }));
  const act = actionOf(room, join[room.id]);

  return (
    <div className="flex min-h-screen flex-col p-4 min-[901px]:h-screen">
      <AppHeader active="home" variant="card" bell={<NotificationBell />} />
      <div className="mx-auto flex w-full min-h-0 max-w-[1408px] flex-1 gap-4 max-[900px]:flex-wrap">
        <RoomSidebar selected={room.id} join={join} />
        <main className="thin-scroll min-h-0 min-w-0 flex-[999_1_640px] overflow-y-auto rounded-[20px] bg-surface px-7 pb-9 pt-7 max-[900px]:overflow-visible max-sm:px-4">
          <div className="flex flex-wrap items-start gap-7">
            <RoomInfo room={room} />
            <aside aria-label="참가 정보" className="flex max-w-[360px] flex-[1_1_300px] flex-col gap-[14px]">
              <JoinCard room={room} act={act} onJoin={() => set("joined")} onApply={() => set("pending")} onCancel={() => set("none")} />
              <GlanceCard glance={room.glance} />
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
