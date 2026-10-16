"use client";

import { useEffect, useState } from "react";

/** action: 토스트 안의 버튼 하나(예: 개인 목표 완료 "되돌리기"). 누르면 토스트를 닫고 onClick */
export type ToastMsg = { text: string; tone: "ok" | "bad"; action?: { label: string; onClick: () => void } } | null;

export function Toast({ msg, onClose }: { msg: ToastMsg; onClose: () => void }) {
  // 버튼이 있는 토스트는 마우스를 올리거나 포커스가 안에 있는 동안 닫히지 않는다(WCAG 2.2.1). 글자만 있는 토스트는 그대로
  // 붙잡은 토스트를 객체로 기억 — 새 토스트가 오면 자동으로 풀린다
  const [heldMsg, setHeldMsg] = useState<ToastMsg>(null);
  const paused = !!msg?.action && heldMsg === msg;
  useEffect(() => {
    if (!msg || paused) return;
    // 버튼이 있으면 누를 시간을 조금 더 준다
    const id = setTimeout(onClose, msg.action ? 6000 : 4000);
    return () => clearTimeout(id);
  }, [msg, onClose, paused]);
  if (!msg) return null;
  const action = msg.action;
  // 글자만 있는 알림이라 클릭을 받을 일이 없다 — 아래 버튼(회차 추가 등)을 가리지 않게 통과시킨다 (V2-07). 버튼이 있으면 토스트만 클릭을 받는다
  return (
    <div
      role={msg.tone === "bad" ? "alert" : "status"}
      className={`fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[14px] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_12px_32px_rgba(27,34,48,.25)] ${action ? "pointer-events-auto max-w-[calc(100vw-32px)] py-[6px] pr-[6px]" : "pointer-events-none"}`}
      style={{ background: msg.tone === "ok" ? "#1B2230" : "#B4462B" }}
      {...(action && {
        // mouseover/out(버블링) — 합성 onMouseEnter 로는 실측(ego-lite 포인터 이동)에서 멈춤이 걸리지 않았다
        onMouseOver: () => setHeldMsg(msg),
        onMouseOut: (e: React.MouseEvent<HTMLDivElement>) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeldMsg(null);
        },
        onFocus: () => setHeldMsg(msg),
        onBlur: () => setHeldMsg(null),
      })}
    >
      {msg.text}
      {action && (
        <button
          type="button"
          onClick={() => {
            onClose();
            action.onClick();
          }}
          className="min-h-11 shrink-0 rounded-[10px] px-3 text-[14px] font-bold text-mint-bright hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-mint-bright"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
