/** 켜고 끄는 스위치 (role="switch") — /me 옵션 메일, 방 만들기 토글 공용 */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="relative h-7 w-12 shrink-0 rounded-full transition-colors" style={{ background: on ? "#12A386" : "#C9D1D6" }}>
      <span className="absolute top-[3px] h-[22px] w-[22px] rounded-full bg-white transition-[left]" style={{ left: on ? 23 : 3 }} />
    </button>
  );
}
