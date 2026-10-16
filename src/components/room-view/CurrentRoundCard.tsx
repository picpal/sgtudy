import { Avatar } from "@/components/ui/Avatar";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusIcon } from "@/components/ui/StatusIcon";
import { PAL } from "@/lib/palette";
import { STATUS_LABEL } from "@/lib/types";
import { type Room } from "@/data/room-view";

export function CurrentRoundCard({ cur }: { cur: Room["cur"] }) {
  return (
    <div className="mt-[22px] flex flex-col gap-[14px] rounded-[18px] border border-line px-5 py-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="inline-flex h-7 items-center gap-[6px] rounded-[14px] bg-lav-soft px-[11px] text-[12px] font-semibold text-lav-text">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4l2.5 2" />
          </svg>
          {cur.pill}
        </span>
      </div>
      <div>
        <div className="text-[17px] font-bold">{cur.title}</div>
        <div className="mt-1 text-[13px] text-muted">{cur.meta}</div>
      </div>
      {cur.tasks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {cur.tasks.map((t) => {
            const subs = t.people.filter((p) => p.status === "done" || p.status === "late").length;
            const allPlanned = t.people.every((p) => p.status === "planned");
            const shown = t.people.slice(0, 4);
            const type = t.type === "공통" ? PAL.mint : t.type === "개인" ? PAL.slate : PAL.lav;
            return (
              <li key={t.title} className="flex flex-wrap items-center gap-[14px] rounded-xl bg-surface-2 px-[14px] py-3">
                <div className="min-w-0 flex-[1_1_200px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md px-[7px] py-[2px] text-[11px] font-bold" style={{ background: type.bg, color: type.fg }}>
                      {t.type}
                    </span>
                    <span className="text-[14px] font-semibold">{t.title}</span>
                  </div>
                  <div className="mt-1 text-[12px] text-muted">{t.dates}</div>
                </div>
                <div className="flex items-center">
                  {shown.map((p, i) => (
                    <span
                      key={p.name}
                      title={`${p.name} · ${STATUS_LABEL[p.status]}`}
                      className="relative inline-flex rounded-full border-2 border-surface-2"
                      style={{ marginLeft: i === 0 ? 0 : -6 }}
                    >
                      <Avatar name={p.name} tone={p.tone} id={p.userId} size={30} />
                      <span className="absolute -bottom-[3px] -right-[3px] flex rounded-full bg-white">
                        <StatusIcon status={p.status} size={15} />
                      </span>
                    </span>
                  ))}
                  {t.people.length > shown.length && (
                    <span className="-ml-[6px] inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-soft text-[11px] font-bold text-ink-3">
                      +{t.people.length - shown.length}
                    </span>
                  )}
                </div>
                <div className="flex w-24 flex-col gap-[5px]">
                  {t.people.length === 0 ? (
                    <span className="text-right text-[12px] font-semibold text-muted">담당자 미정</span>
                  ) : (
                    <>
                      <span className="text-right text-[12px] font-semibold">
                        {allPlanned ? `${t.dates.split(" – ")[0]} 시작` : `${subs}/${t.people.length} 제출`}
                      </span>
                      <ProgressBar pct={Math.round((subs / t.people.length) * 100)} height={5} />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
