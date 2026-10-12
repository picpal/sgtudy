import { AVATAR_PAL, PAL, toneOf, type Tone } from "@/lib/palette";

type Props = {
  name: string;
  size?: number;
  tone?: Tone;
  /** Main 카드처럼 조금 진한 팔레트 */
  strong?: boolean;
  /** 승인 대기 — 회색 + 점선 테두리 */
  pending?: boolean;
  className?: string;
  title?: string;
};

export function Avatar({ name, size = 30, tone, strong, pending, className = "", title }: Props) {
  const t = tone ?? toneOf(name);
  const c = pending ? { bg: "#E9EEF0", fg: "#8C97A4" } : (strong ? AVATAR_PAL : PAL)[t];
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
