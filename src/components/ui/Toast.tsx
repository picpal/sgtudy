"use client";

import { useEffect } from "react";

export type ToastMsg = { text: string; tone: "ok" | "bad" } | null;

export function Toast({ msg, onClose }: { msg: ToastMsg; onClose: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(onClose, 4000);
    return () => clearTimeout(id);
  }, [msg, onClose]);
  if (!msg) return null;
  // 글자만 있는 알림이라 클릭을 받을 일이 없다 — 아래 버튼(회차 추가 등)을 가리지 않게 통과시킨다 (V2-07)
  return (
    <div role={msg.tone === "bad" ? "alert" : "status"} className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[14px] px-5 py-3 text-[14px] font-semibold text-white shadow-[0_12px_32px_rgba(27,34,48,.25)]" style={{ background: msg.tone === "ok" ? "#1B2230" : "#B4462B" }}>
      {msg.text}
    </div>
  );
}
