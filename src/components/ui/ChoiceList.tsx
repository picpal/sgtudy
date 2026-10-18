"use client";

import { useId } from "react";

export type Choice<K extends string> = { key: K; label: string; note?: string };

/** 확인 창 안의 단일 선택(라디오) — 한 줄 전체가 누르는 영역(44px 이상). legend 는 화면에 보이지 않는 그룹 이름 */
export function ChoiceList<K extends string>({ legend, choices, value, onChange }: { legend: string; choices: Choice<K>[]; value: K; onChange: (k: K) => void }) {
  const name = useId();
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="sr-only">{legend}</legend>
      {choices.map((c) => (
        <label
          key={c.key}
          className={`flex min-h-11 cursor-pointer items-start gap-[10px] rounded-[12px] border px-3 py-[10px] ${value === c.key ? "border-mint bg-[#F2FBF8]" : "border-line bg-surface"}`}
        >
          <input type="radio" name={name} value={c.key} checked={value === c.key} onChange={() => onChange(c.key)} className="mt-[3px] size-4 shrink-0 accent-[#0D7A64]" />
          <span className="flex min-w-0 flex-col gap-[2px]">
            <span className="text-[14px] font-semibold text-ink">{c.label}</span>
            {c.note && <span className="text-[12px] leading-[1.5] text-muted">{c.note}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
