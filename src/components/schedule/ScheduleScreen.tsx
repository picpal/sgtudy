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
import { ScheduleEmpty } from "./ScheduleEmpty";
import { monthSel } from "./calc";
import { stickyAside, useStickyFit } from "@/lib/useStickyFit";

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
  /** 달을 옮기면 선택일은 그 달의 오늘, 아니면 1일 — 이전 선택일을 끌고 가지 않는다 (Q1-19/Q3-20) */
  const shift = (dm: number) => {
    const from = target.current ?? { y, m };
    const d = new Date(Date.UTC(from.y, from.m + dm, 1));
    const ny = d.getUTCFullYear();
    const nm = d.getUTCMonth();
    void load(ny, nm, monthSel(ny, nm, today));
  };
  const goToday = () => {
    const ty = +today.slice(0, 4);
    const tm = +today.slice(5, 7) - 1;
    if (!target.current && ty === y && tm === m) setSel(today); // 이동 중이면 오늘 달로 다시 조회해 최신 요청으로 만든다
    else void load(ty, tm, today);
  };
  const toggle = (id: string) => setOff(on(id) ? [...off, id] : off.filter((x) => x !== id));

  // 날짜를 누르면 일 패널을 화면으로 끌어온다(페이지 스크롤). ≤900 (CSS 는 Tailwind max-[901px] = width < 901, JS 는 max-width: 900px — 같은 구간)
  // 에서는 패널이 달력 아래라 항상 (Q3-05), 넓은 화면은 요약 열이 붙지 못해(화면보다 길다) 패널 머리가 화면 밖일 때만
  const dayRef = useRef<HTMLElement>(null);
  const [asideRef, asideFits] = useStickyFit<HTMLElement>();
  const pick = (k: string) => {
    setSel(k);
    const el = dayRef.current;
    if (!el) return;
    const narrow = window.matchMedia("(max-width: 900px)").matches;
    const top = el.getBoundingClientRect().top;
    if (!narrow && top >= 0 && top < window.innerHeight - 120) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  };

  if (data.studies.length === 0) return <ScheduleEmpty />;

  return (
    // 한 페이지 스크롤 — 화면 높이에 가두지 않는다. 예전에는 넓은 화면을 h-screen 에 가두고 달력·패널에 안쪽 스크롤(overflow-auto +
    // overscroll-behavior: contain)을 두었는데, 넘칠 게 없는 안쪽 스크롤러도 휠·터치를 붙잡고 문서로 넘기지 않아 화면 밖 내용을 볼 수 없었다
    <div className="box-border flex min-h-screen flex-col p-4">
      <AppHeader active="schedule" variant="card" bell={<NotificationBell />} />
      <div className="mx-auto flex w-full max-w-[1408px] flex-1 items-start gap-4 max-[901px]:flex-wrap">
        <main className="flex min-w-0 flex-[999_1_720px] flex-col self-stretch rounded-[20px] bg-surface px-6 pt-6 pb-[18px] max-sm:px-4 max-sm:pt-4" aria-busy={loading}>
          <Toolbar y={y} m={m} view={view} off={off} studies={data.studies} onPrev={() => shift(-1)} onNext={() => shift(1)} onToday={goToday} onToggle={toggle} onView={setView} />
          {view === "month" ? (
            <MonthGrid y={y} m={m} sel={sel} today={today} studies={data.studyMap} tasks={tasks} markers={markers} onPick={pick} />
          ) : (
            <ListView y={y} m={m} today={today} studies={data.studyMap} tasks={tasks} />
          )}
          {view === "month" && <Legend />}
        </main>
        {/* >900 에서는 폭을 고정해(340, 넓으면 380) 일 패널 제목이 줄어들지 않게 한다 (V2-01). ≤900 은 달력 아래로 내려가고, 태블릿(601~900)은 두 패널을 나란히 */}
        <aside ref={asideRef} aria-label="일정 요약" className={`${stickyAside(asideFits)} flex min-w-0 flex-col gap-4 max-[901px]:basis-full min-[601px]:max-[901px]:grid min-[601px]:max-[901px]:grid-cols-2 min-[601px]:max-[901px]:items-start min-[901px]:flex-[0_0_340px] min-[1201px]:basis-[380px]`}>
          <DayPanel ref={dayRef} sel={sel} today={today} studies={data.studyMap} tasks={tasks} markers={markers} />
          <UpcomingPanel today={today} studies={data.studyMap} upcoming={upcoming} />
        </aside>
      </div>
      <Toast msg={toast} onClose={closeToast} />
    </div>
  );
}
