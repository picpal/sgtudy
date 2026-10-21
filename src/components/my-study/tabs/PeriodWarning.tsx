"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { EndDateForm } from "@/components/room-view/EndDateForm";
import type { ToastMsg } from "@/components/ui/Toast";
import { dateShort } from "@/lib/api/format";
import { useToday } from "@/lib/today";
import { useRefocusOnClose } from "@/lib/useRefocusOnClose";
import type { PeriodGap } from "../rounds";

type Props = {
  gap: PeriodGap;
  slug: string;
  /** 진행중이면 시작일이 잠기고 종료일은 마지막 마감 이후로만 — 문구가 달라진다 */
  roomStatus: "draft" | "recruit" | "active";
  /** 진행목표 편집 권한(그룹장 + 권한 받은 팀원) — 기간 맞추기 안내 */
  canEdit: boolean;
  /** room_update 는 그룹장만 — 종료일 늘리기 */
  isLeader: boolean;
  /** 진행목표 편집 모드로. 이미 편집 모드 안이면 넘기지 않는다(버튼 대신 안내 문구) */
  onEditRounds?: () => void;
  toast: (m: ToastMsg) => void;
};

// 「그대로 두기」 — 이 브라우저에서만 숨긴다(문구 = 개수·기간이 바뀌면 다시 보인다). 저장소가 막혀도 경고는 그대로 뜬다
const KEPT_EVENT = "sgtudy:period-kept";
const keptKey = (slug: string) => `sgtudy:period-kept:${slug}`;
const subscribeKept = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(KEPT_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(KEPT_EVENT, cb);
  };
};
const readKept = (slug: string) => {
  try {
    return window.localStorage.getItem(keptKey(slug));
  } catch {
    return null;
  }
};

const BTN = "h-11 rounded-[22px] border border-[#E2C77F] bg-surface px-4 text-[13px] font-semibold text-[#6B4700]";

/**
 * "회차 n개가 스터디 기간(…)을 벗어나요" 경고 줄 — 진행목표(보기·편집)·개요 공용.
 * 편집자에게 기간 맞추기: 회차 기간 고치기(편집 모드로) · 그대로 두기(이 브라우저에서 숨김) · 그룹장이면 종료일 늘리기(마지막 마감으로 채운 EndDateForm)
 */
export function PeriodWarning({ gap, slug, roomStatus, canEdit, isLeader, onEditRounds, toast }: Props) {
  const active = roomStatus === "active";
  const today = useToday();
  const router = useRouter();
  const [editEnd, setEditEnd] = useState(false);
  const refocus = useRefocusOnClose(editEnd);
  const kept = useSyncExternalStore(subscribeKept, () => readKept(slug), () => null);
  const canExtend = isLeader && !!gap.fitEnd;
  const keep = () => {
    try {
      window.localStorage.setItem(keptKey(slug), gap.text);
    } catch {
      /* 저장소가 막힌 브라우저 — 숨기지 못해도 동작에는 지장 없다 */
    }
    window.dispatchEvent(new Event(KEPT_EVENT));
    toast({ text: "경고를 숨겼어요 · 기간을 벗어난 일정이 바뀌면 다시 알려 드려요", tone: "ok" });
  };
  const closeForm = () => {
    refocus(() => document.querySelector<HTMLButtonElement>("[data-period-warning] [data-extend-end]"));
    setEditEnd(false);
  };
  if (canEdit && kept === gap.text) return null;
  return (
    <div data-period-warning className="flex flex-col gap-2 rounded-[12px] border border-[#F0D79A] bg-[#FDF4E1] px-[14px] py-3 text-[13px] font-medium leading-[1.5] text-[#6B4700]">
      <span className="flex items-start gap-[10px]">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-[1px] shrink-0">
          <path d="M12 3 2 20h20z" />
          <path d="M12 10v4" />
          <circle cx="12" cy="17" r=".6" />
        </svg>
        <span>
          {/* 낭독은 경고 문구만 — 아래 버튼·폼(hint·오류 alert)은 감싸지 않는다 */}
          <span role="status">{gap.text}</span>
          {canEdit && !onEditRounds && <> · 회차를 눌러 기간을 고쳐 주세요{canExtend ? " · 종료일을 늘려도 돼요" : ""}</>}
          {canEdit && gap.before && <> · 시작일 앞에 걸친 일정은 회차 기간을 고쳐 맞춰 주세요{active ? " · 진행중에는 시작일을 바꿀 수 없어요" : ""}</>}
        </span>
      </span>
      {canEdit && editEnd && gap.fitEnd ? (
        <EndDateForm
          slug={slug}
          initial={gap.fitEnd}
          min={gap.fitEnd}
          hint={`마지막 마감 ${dateShort(gap.fitEnd, today)}${active ? " · 진행중에는 마지막 마감 이후로만 바꿀 수 있어요" : ""}`}
          onSaved={() => {
            setEditEnd(false);
            toast({ text: gap.before ? "종료일을 바꿨어요 · 시작일 앞 일정은 회차 기간을 고쳐 주세요" : "종료일을 바꿨어요 · 일정이 스터디 기간 안에 들어와요", tone: "ok" });
            router.refresh();
          }}
          onCancel={closeForm}
        />
      ) : (
        canEdit && (
          <div className="flex flex-wrap gap-2">
            {onEditRounds && (
              <button type="button" onClick={onEditRounds} className={BTN}>
                회차 기간 고치기
              </button>
            )}
            <button type="button" data-keep-period onClick={keep} className={BTN}>
              그대로 두기
            </button>
            {canExtend && (
              <button type="button" data-extend-end onClick={() => setEditEnd(true)} className={BTN}>
                종료일 늘리기
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}
