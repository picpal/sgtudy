"use client";

import { useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { TODAY } from "@/lib/routes";
import { MARKERS, TASKS, type StudyId } from "@/data/schedule";
import { Toolbar, type View } from "./Toolbar";
import { MonthGrid } from "./MonthGrid";
import { ListView } from "./ListView";
import { Legend } from "./Legend";
import { DayPanel } from "./DayPanel";
import { UpcomingPanel } from "./UpcomingPanel";

export function ScheduleScreen() {
  const [y, setY] = useState(2026);
  const [m, setM] = useState(9);
  const [sel, setSel] = useState(TODAY);
  const [view, setView] = useState<View>("month");
  const [off, setOff] = useState<StudyId[]>([]);

  const on = (id: StudyId) => !off.includes(id);
  const tasks = TASKS.filter((t) => on(t.study));
  const markers = MARKERS.filter((mk) => on(mk.study));

  const shift = (dm: number) => {
    const d = new Date(Date.UTC(y, m + dm, 1));
    setY(d.getUTCFullYear());
    setM(d.getUTCMonth());
  };
  const goToday = () => {
    setY(2026);
    setM(9);
    setSel(TODAY);
  };
  const toggle = (id: StudyId) => setOff(on(id) ? [...off, id] : off.filter((x) => x !== id));

  return (
    <div className="box-border flex h-screen flex-col p-4 max-[900px]:h-auto max-[900px]:min-h-screen">
      <AppHeader active="schedule" variant="card" bell={<NotificationBell />} />
      <div className="mx-auto flex w-full max-w-[1408px] min-h-0 flex-1 items-stretch gap-4 max-[900px]:flex-wrap">
        <main className="flex min-h-0 min-w-0 flex-[999_1_720px] flex-col rounded-[20px] bg-surface px-6 pt-6 pb-[18px] max-sm:px-4 max-sm:pt-4">
          <Toolbar y={y} m={m} view={view} off={off} onPrev={() => shift(-1)} onNext={() => shift(1)} onToday={goToday} onToggle={toggle} onView={setView} />
          {view === "month" ? (
            <MonthGrid y={y} m={m} sel={sel} tasks={tasks} markers={markers} onPick={setSel} />
          ) : (
            <ListView y={y} m={m} tasks={tasks} />
          )}
          <Legend />
        </main>
        <aside aria-label="일정 요약" className="flex min-h-0 flex-[1_1_320px] max-w-[380px] flex-col gap-4 max-[900px]:max-w-none">
          <DayPanel sel={sel} tasks={tasks} markers={markers} />
          <UpcomingPanel tasks={tasks} />
        </aside>
      </div>
    </div>
  );
}
