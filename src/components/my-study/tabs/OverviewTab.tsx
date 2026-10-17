"use client";

import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusIcon } from "@/components/ui/StatusIcon";
import { STATUS_LABEL, type TaskStatus } from "@/lib/types";
import type { StudyRoom } from "@/lib/api/my-study";
import { routes } from "@/lib/routes";
import { RingedStatus, TypeBadge, toneOfName } from "../bits";
import { personalStats, type Tree } from "../model";
import { Inline, MarkdownView } from "../MarkdownView";

const MAX_PEOPLE = 4;

/** 빈 섹션 안내 (Q2-11) — 그룹장에게는 채우는 곳으로 가는 링크 */
function Empty({ text, href, cta }: { text: string; href?: string; cta?: string }) {
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 rounded-[12px] bg-surface-2 px-[14px] py-3 text-[13px] text-muted">
      {text}
      {href && cta && (
        <Link href={href} className="inline-flex min-h-11 items-center font-semibold text-mint hover:text-mint-dark">
          {cta}
        </Link>
      )}
    </p>
  );
}

const H3 = ({ children, icon, mt }: { children: string; icon: React.ReactNode; mt: number }) => (
  <h3 className="mb-[10px] flex items-center gap-2 text-[15px] font-bold" style={{ marginTop: mt }}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#1B2230" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      {icon}
    </svg>
    {children}
  </h3>
);

const LEGEND: [TaskStatus, string][] = [
  ["done", "기한내 제출"],
  ["late", "지각 제출"],
  ["missed", "미제출(경과)"],
  ["open", "진행중"],
  ["planned", "예정"],
];

/** 참가자 내 카드 줄 — "개인 목표 이번 회차 d/t 완료 · 내 과제에서 보기 →" (팀 수치와 따로) */
export function MyPersonalLine({ tree, userId, roundId, slug }: { tree: Tree; userId: string; roundId: string; slug: string }) {
  const { done, total } = personalStats(tree.personal, userId, roundId);
  return (
    <div data-my-personal className="flex flex-wrap items-center gap-x-2 rounded-[12px] bg-personal-bg px-[14px] text-[13px] text-ink-2">
      <TypeBadge type="개인" />
      <span>
        {total === 0 ? (
          "이번 회차 개인 목표가 아직 없어요"
        ) : (
          <>
            개인 목표 이번 회차 <b className="font-bold text-ink">{done}/{total}</b> 완료
          </>
        )}
      </span>
      <Link href={routes.tasks({ study: slug })} className="inline-flex min-h-11 items-center font-semibold text-mint hover:text-mint-dark">
        내 과제에서 보기 →
      </Link>
    </div>
  );
}

/** roundId = 개인 목표 "이번 회차"(thisRoundId — /tasks 와 같은 규칙). 모집·진행 중이 아닌 방이면 null → 내 개인 목표 줄 없음 */
export function OverviewTab({ room, tree, roundId, onGoCurriculum, periodWarning }: { room: StudyRoom; tree: Tree; roundId: string | null; onGoCurriculum: () => void; periodWarning?: React.ReactNode }) {
  const cur = room.cur;
  const hasTasks = cur.tasks.length > 0;
  // 참가 중인 나(그룹장 포함) + 이번 회차가 있을 때만 내 개인 목표 줄
  const meRow = room.members.find((m) => m.me && !m.left && !m.pending);
  const owner = room.action === "owner";
  const settings = owner ? routes.roomSettings(room.id) : undefined;
  return (
    <>
      {/* 방 기간을 벗어난 회차 경고 (PeriodWarning — 진행목표와 같은 줄) */}
      {periodWarning && <div className="mt-[22px]">{periodWarning}</div>}
      {/* 이번 회차 */}
      <div className="mt-[22px] flex flex-col gap-[14px] rounded-[18px] border border-line px-5 py-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex h-7 items-center gap-[6px] rounded-[14px] bg-lav-soft px-[11px] text-[12px] font-semibold text-lav-text">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4l2.5 2" />
            </svg>
            {cur.pill}
          </span>
          {hasTasks && (
            <button type="button" onClick={onGoCurriculum} className="inline-flex h-9 items-center rounded-[18px] border border-line bg-surface px-[14px] text-[13px] font-medium text-ink">
              진행목표 전체 보기
            </button>
          )}
        </div>
        <div>
          <div className="text-[17px] font-bold">{cur.title}</div>
          <div className="mt-1 text-[13px] text-muted">{cur.meta}</div>
        </div>
        {hasTasks && (
          <>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {cur.tasks.map((t) => {
                const subs = t.people.filter(([, s]) => s === "done" || s === "late").length;
                const allPlanned = t.people.every(([, s]) => s === "planned");
                const shown = t.people.slice(0, MAX_PEOPLE);
                const over = t.people.length - shown.length;
                const pct = t.people.length === 0 ? 0 : Math.round((subs / t.people.length) * 100);
                return (
                  <li key={t.title} className="flex flex-wrap items-center gap-[14px] rounded-[12px] bg-surface-2 px-[14px] py-3">
                    <div className="min-w-0 flex-[1_1_200px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <TypeBadge type={t.type} />
                        <span className="text-[14px] font-semibold">{t.title}</span>
                      </div>
                      <div className="mt-1 text-[12px] text-muted">{t.dates}</div>
                    </div>
                    <div className="flex items-center">
                      {shown.map(([name, s], i) => (
                        <span key={name} title={`${name} · ${STATUS_LABEL[s]}`} className="relative inline-flex rounded-full border-2 border-[#F7FAF9]" style={{ marginLeft: i === 0 ? 0 : -6 }}>
                          <Avatar name={name} size={30} tone={t.tones?.[name] ?? toneOfName(name)} id={t.ids?.[name]} />
                          <span className="absolute -right-[3px] -bottom-[3px] flex">
                            <RingedStatus status={s} size={15} />
                          </span>
                        </span>
                      ))}
                      {over > 0 && <span className="-ml-[6px] inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-soft text-[11px] font-bold text-ink-3">+{over}</span>}
                    </div>
                    <div className="flex w-24 flex-col gap-[5px]">
                      {t.people.length === 0 ? (
                        <span className="text-right text-[12px] font-semibold text-muted">담당자 미정</span>
                      ) : (
                        <>
                          <span className="text-right text-[12px] font-semibold">{allPlanned ? `${t.dates.split(" – ")[0]} 시작` : `${subs}/${t.people.length} 제출`}</span>
                          <ProgressBar pct={pct} height={5} fill={subs === t.people.length ? "#1E9E6A" : "#12A386"} />
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap gap-[14px] text-[12px] text-ink-3">
              {LEGEND.map(([s, label]) => (
                <span key={s} className="inline-flex items-center gap-[5px]">
                  <StatusIcon status={s} size={13} label={false} />
                  {label}
                </span>
              ))}
            </div>
          </>
        )}
        {meRow?.userId && roundId && <MyPersonalLine tree={tree} userId={meRow.userId} roundId={roundId} slug={room.id} />}
      </div>

      <H3 mt={30} icon={<><path d="M12 11v6" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" /><circle cx="12" cy="7.5" r="1.4" fill="#FFFFFF" /></>}>스터디 소개</H3>
      {room.about.trim() ? <MarkdownView src={room.about} /> : <Empty text="아직 스터디 소개가 없어요" href={settings} cta="방 설정에서 쓰기 →" />}

      <H3 mt={26} icon={<path d="m8 12.2 2.8 2.8L16.5 9" stroke="#FFFFFF" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />}>운영 규칙</H3>
      {room.rules.length ? (
        <ul className="m-0 pl-5 text-[14px] leading-[1.75] text-ink-2">
          {room.rules.map((r) => (
            <li key={r}>
              <Inline text={r} />
            </li>
          ))}
        </ul>
      ) : (
        <Empty text="아직 운영 규칙이 없어요" href={settings} cta="방 설정에서 쓰기 →" />
      )}

      <h3 className="mb-3 mt-[26px] flex items-center gap-2 text-[15px] font-bold">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#1B2230" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M7.5 9h9M7.5 12.5h9M7.5 16h5" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
        </svg>
        전체 일정
      </h3>
      {room.rounds.length === 0 && (
        <p className="m-0 flex flex-wrap items-center gap-x-2 rounded-[12px] bg-surface-2 px-[14px] py-3 text-[13px] text-muted">
          {owner ? "아직 회차가 없어요" : "아직 회차가 없어요 · 그룹장이 진행목표를 준비하고 있어요"}
          {owner && (
            <button type="button" onClick={onGoCurriculum} className="inline-flex min-h-11 items-center font-semibold text-mint hover:text-mint-dark">
              진행목표에서 회차 만들기 →
            </button>
          )}
        </p>
      )}
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {room.rounds.map((rd) => {
          // 숫자는 트리 집계로 통일 (sub / 담당 건수)
          const rt = tree.roots.find((r) => r.id === rd.roundId);
          const sub = rt ? rt.sub : rd.sub;
          const total = rt ? rt.asg : rd.total;
          const pct = total ? Math.round((sub / total) * 100) : 0;
          return (
            <li
              key={rd.label}
              className="flex flex-wrap items-center gap-3 rounded-[12px] border px-[14px] py-3"
              style={{ borderColor: rd.current ? "#9ED9C8" : "#EEF2F1", background: rd.current ? "#F2FBF8" : "#FFFFFF" }}
            >
              <span className="w-16 shrink-0 text-[13px] font-bold">{rd.label}</span>
              <span className="min-w-0 flex-[1_1_180px]">
                <span className="block text-[14px] font-semibold">{rd.title}</span>
                <span className="mt-[2px] block text-[12px] text-muted">
                  {rd.dates} · {rd.state}
                </span>
              </span>
              <span className="flex w-[140px] items-center gap-2">
                <ProgressBar pct={pct} height={6} fill={pct >= 80 ? "#1E9E6A" : "#12A386"} className="flex-1" />
                <span className="w-[58px] text-right text-[12px] font-semibold">{rd.alt ?? `${sub}/${total}`}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {room.moreRounds && <p className="mb-0 mt-[10px] text-[13px] text-muted">{room.moreRounds}</p>}
    </>
  );
}
