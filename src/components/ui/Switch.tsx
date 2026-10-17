"use client";

/** 켜고 끄는 스위치 (role="switch") — /me 옵션 메일, 방 만들기·방 설정 토글 공용. 보이는 크기 48x28, 누르는 자리는 위아래로 늘려 48x44 (Q2-5) */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className="relative h-7 w-12 shrink-0 rounded-full transition-colors before:absolute before:inset-x-0 before:-inset-y-2 before:content-[''] disabled:opacity-60" style={{ background: on ? "#12A386" : "#C9D1D6" }}>
      <span className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-[left]" style={{ left: on ? 23 : 3 }} />
    </button>
  );
}
