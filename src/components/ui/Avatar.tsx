import { avatarColors, toneOf, type Tone } from "@/lib/palette";

type Props = {
  name: string;
  size?: number;
  tone?: Tone;
  /** userId — 주면 같은 이니셜·같은 tone 끼리도 연한/진한 변형으로 갈린다 (avatarColors) */
  id?: string;
  /** Main 카드처럼 조금 진한 팔레트 */
  strong?: boolean;
  /** 승인 대기 — 회색 + 점선 테두리 */
  pending?: boolean;
  className?: string;
  title?: string;
};

export function Avatar({ name, size = 30, tone, id, strong, pending, className = "", title }: Props) {
  const t = tone ?? toneOf(name);
  const c = pending ? { bg: "#E9EEF0", fg: "#8C97A4" } : avatarColors(t, { id, strong });
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${className}`}
      style={{
        width: size,
        height: size,
        background: c.bg,
        color: c.fg,
        fontSize: Math.round(size * 0.42),
        border: pending ? "1.5px dashed #A7B0BA" : undefined,
      }}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {name.charAt(0)}
    </span>
  );
}
