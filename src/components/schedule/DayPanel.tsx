import Link from "next/link";
import type { Ref } from "react";
import { dday, md, weekdayKo } from "@/lib/date";
import { routes } from "@/lib/routes";
import { STATUS_LABEL } from "@/lib/types";
import { shortName, type Marker, type Study, type Task } from "@/data/schedule";
import { isUrgent, taskHref } from "./calc";

type Props = { sel: string; today: string; studies: Record<string, Study>; tasks: Task[]; markers: Marker[]; ref?: Ref<HTMLElement> };

type Item = { key: string; study: string; href: string; title: string; sub: string; badge: string; urgent?: boolean };

export function DayPanel({ sel, today, studies, tasks, markers, ref }: Props) {
  const starts: Item[] = markers
    .filter((mk) => mk.date === sel)
    .map((mk) => ({
      key: `s-${mk.study}`,
      study: mk.study,
      href: studies[mk.study].pending ? routes.room(mk.study) : routes.myStudy(mk.study),
      title: `${mk.round} 회차 시작`,
      sub: studies[mk.study].pending ? "승인되면 참여할 수 있어요" : "새 과제가 열렸어요",
      badge: "시작",
    }));
  const due: Item[] = tasks
    .filter((t) => t.e === sel)
    .map((t) => ({
      key: `d-${t.id}`,
      study: t.study,
      href: taskHref(t, studies[t.study]),
      title: t.title,
      sub: `${t.round} · ${md(t.s)}–${md(t.e)} · ${STATUS_LABEL[t.st]}`,
      badge: t.st === "done" || t.st === "late" ? STATUS_LABEL[t.st] : `마감 ${dday(today, t.e)}`,
      urgent: isUrgent(t),
    }));
  const ongoing: Item[] = tasks
    .filter((t) => t.s <= sel && t.e > sel)
    .map((t) => ({ key: `o-${t.id}`, study: t.study, href: taskHref(t, studies[t.study]), title: t.title, sub: `${t.round} · ${md(t.e)} 마감`, badge: STATUS_LABEL[t.st] }));

  const groups = (
    [
      ["회차 시작", starts],
      ["이 날 마감", due],
      ["진행 중인 과제", ongoing],
    ] as [string, Item[]][]
  ).filter(([, items]) => items.length);

  return (
    <section ref={ref} className="box-border flex scroll-mt-4 flex-col gap-[14px] rounded-[20px] bg-surface p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-[18px] font-bold">
          {Number(sel.slice(5, 7))}월 {Number(sel.slice(8, 10))}일 ({weekdayKo(sel)})
        </h2>
        {sel === today && <span className="rounded-[7px] bg-ink px-2 py-[2px] text-[12px] font-bold text-white">오늘</span>}
      </div>
      {groups.map(([label, items]) => (
        <div key={label} className="flex flex-col gap-2">
          <div className="text-[12px] font-semibold text-muted">{label}</div>
          {items.map((it) => {
            const S = studies[it.study];
            return (
              <Link
                key={it.key}
                href={it.href}
                className="box-border flex min-h-11 flex-col gap-[6px] rounded-[12px] border border-line-2 px-3 py-[10px] text-ink hover:text-ink"
              >
                {/* 배지는 윗줄로 — 제목이 배지 폭에 밀려 0px 이 되지 않게 한 줄을 통째로 준다 (V2-01) */}
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate rounded-[7px] px-2 py-[3px] text-[11px] font-bold" style={{ background: S.bg, color: S.fg }}>
                    {shortName(S)}
                  </span>
                  <span
                    className="shrink-0 whitespace-nowrap rounded-[7px] px-2 py-[3px] text-[11px] font-bold"
                    style={{ color: it.urgent ? "#FFFFFF" : "#3A4452", background: it.urgent ? "#B4462B" : "#EEF2F1" }}
                  >
                    {it.badge}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold text-ink">{it.title}</span>
                  <span className="mt-[2px] block text-[12px] text-muted">{it.sub}</span>
                </span>
              </Link>
            );
          })}
        </div>
      ))}
      {groups.length === 0 && (
        <div className="rounded-[14px] border border-dashed border-line-dash px-[14px] py-5 text-center text-[13px] text-muted">이 날은 예정된 일정이 없어요</div>
      )}
    </section>
  );
}
