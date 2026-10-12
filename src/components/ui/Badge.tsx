import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  bg: string;
  fg: string;
  /** px */
  height?: number;
  fontSize?: number;
  radius?: number;
  px?: number;
  weight?: 500 | 600 | 700;
  className?: string;
  title?: string;
};

/** 작은 색 배지/칩. 색은 호출부가 토큰 hex 로 넘긴다. */
export function Badge({ children, bg, fg, height = 24, fontSize = 12, radius = 8, px = 9, weight = 600, className = "", title }: Props) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap ${className}`}
      style={{ background: bg, color: fg, height, fontSize, borderRadius: radius, padding: `0 ${px}px`, fontWeight: weight }}
      title={title}
    >
      {children}
    </span>
  );
}
