"use client";

import { useCallback, useRef, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { fetchSchedule, scheduleWindow, toScheduleData } from "@/lib/api/schedule";
import type { ScheduleResponse } from "@/lib/api/types";
import { Toolbar, type View } from "./Toolbar";
import { MonthGrid } from "./MonthGrid";
import { ListView } from "./ListView";
import { Legend } from "./Legend";
import { DayPanel } from "./DayPanel";
import { UpcomingPanel } from "./UpcomingPanel";

export function ScheduleScreen({ initial }: { initial: ScheduleResponse }) {
  const [data, setData] = useState(() => toScheduleData(initial));
  const today = data.today;
  const [y, setY] = useState(+today.slice(0, 4));
  const [m, setM] = useState(+today.slice(5, 7) - 1);
  const [sel, setSel] = useState(today);
  const [view, setView] = useState<View>("month");
  const [off, setOff] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<ToastMsg>(null);
  const closeToast = useCallback(() => setToast(null), []);

  const on = (id: string) => !off.includes(id);
  const tasks = data.tasks.filter((t) => on(t.study));
  const markers = data.markers.filter((mk) => on(mk.study));
  const upcoming = data.upcoming.filter((t) => on(t.study));

  // 요청 순번 — 이전 달 응답이 늦게 와도 최신 요청 것만 반영한다
  const reqId = useRef(0);
  // 진행 중인 이동의 목표 달 — 빠르게 여러 번 눌러도 커밋 전 값에서 이어서 센다
  const target = useRef<{ y: number; m: number; sel: string } | null>(null);

  /** 달이 바뀌면 창을 다시 계산해 재조회. sel 이 창 밖으로 멀면 scheduleWindow 가 리셋한다. y/m/sel 은 조회가 성공한 뒤에만 바꾼다. */
  const load = async (ny: number, nm: number, nsel: string) => {
    const w = scheduleWindow(ny, nm, nsel);
    const id = ++reqId.current;
    target.current = { y: ny, m: nm, sel: w.sel };
    setLoading(true);
    try {
      const next = toScheduleData(await fetchSchedule(w.from, w.to));
      if (id !== reqId.current) return;
      setData(next);
      setY(ny);
      setM(nm);
      setSel(w.sel);
    } catch (e) {
      if (id !== reqId.current) return;
      setToast({ text: toApiError(e).message, tone: "bad" });
    } finally {
      if (id === reqId.current) {
        target.current = null;
        setLoading(false);
      }
    }
  };
  const shift = (dm: number) => {
    const from = target.current ?? { y, m, sel };
    const d = new Date(Date.UTC(from.y, from.m + dm, 1));
    void load(d.getUTCFullYear(), d.getUTCMonth(), from.sel);
  };
  const goToday = () => {
    const ty = +today.slice(0, 4);
    const tm = +today.slice(5, 7) - 1;
    if (!target.current && ty === y && tm === m) setSel(today); // 이동 중이면 오늘 달로 다시 조회해 최신 요청으로 만든다
    else void load(ty, tm, today);
  };
  const toggle = (id: string) => setOff(on(id) ? [...off, id] : off.filter((x) => x !== id));

  return (
    <div className="box-border flex h-screen flex-col p-4 max-[900px]:h-auto max-[900px]:min-h-screen">
      <AppHeader active="schedule" variant="card" bell={<NotificationBell />} />
      <div className="mx-auto flex w-full max-w-[1408px] min-h-0 flex-1 items-stretch gap-4 max-[900px]:flex-wrap">
        <main className="flex min-h-0 min-w-0 flex-[999_1_720px] flex-col rounded-[20px] bg-surface px-6 pt-6 pb-[18px] max-sm:px-4 max-sm:pt-4" aria-busy={loading}>
          <Toolbar y={y} m={m} view={view} off={off} studies={data.studies} onPrev={() => shift(-1)} onNext={() => shift(1)} onToday={goToday} onToggle={toggle} onView={setView} />
          {view === "month" ? (
            <MonthGrid y={y} m={m} sel={sel} today={today} studies={data.studyMap} tasks={tasks} markers={markers} onPick={setSel} />
          ) : (
            <ListView y={y} m={m} today={today} studies={data.studyMap} tasks={tasks} />
          )}
          <Legend />
        </main>
        <aside aria-label="일정 요약" className="flex min-h-0 flex-[1_1_320px] max-w-[380px] flex-col gap-4 max-[900px]:max-w-none">
          <DayPanel sel={sel} today={today} studies={data.studyMap} tasks={tasks} markers={markers} />
          <UpcomingPanel today={today} studies={data.studyMap} upcoming={upcoming} />
        </aside>
      </div>
      <Toast msg={toast} onClose={closeToast} />
    </div>
  );
}
