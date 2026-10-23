"use client";

import { useId } from "react";
import { openRecruitNote } from "@/lib/api/leader";

/*
 * 「만들면서 바로 모집 시작」(2단계 D35~D38). 새 방은 준비중(DRAFT)이라 모집을 시작해야 목록에 보이고 초대 링크가 열린다.
 * 모집 시작은 말단 과제가 1개 이상일 때만 된다(ROOM_NO_LEAF_TASK) — 회차 초안이 없으면 끈 채 이유를 보여 준다(직접 입력에도 보임)
 */
export const RECRUIT_DISABLED_HINT = "회차에 과제가 1개 이상 있어야 모집을 시작할 수 있어요 · 만든 뒤 내 스터디 상단에서 시작할 수 있어요";

export function RecruitNowField({ checked, disabled, onChange, isPublic, joinMode }: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  isPublic: boolean;
  joinMode: "direct" | "approval";
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 rounded-[12px] border border-line px-4 py-2">
      <label className={`flex min-h-11 items-center gap-3 text-[14px] font-semibold ${disabled ? "text-muted" : "cursor-pointer text-ink"}`}>
        <input
          type="checkbox"
          checked={checked && !disabled}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={`${id}-note`}
          className="size-5 shrink-0 accent-mint"
        />
        만들면서 바로 모집 시작
      </label>
      <p id={`${id}-note`} className="m-0 pb-1 pl-8 text-[12px] text-muted">
        {disabled ? RECRUIT_DISABLED_HINT : openRecruitNote({ isPublic, joinMode })}
      </p>
    </div>
  );
}
