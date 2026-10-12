import type { TaskStatus } from "@/lib/types";
import { STATUS_LABEL } from "@/lib/types";

type Props = { status: TaskStatus; size?: number; className?: string; label?: boolean };

/**
 * 사람별 상태 아이콘 — 색만이 아니라 모양으로도 구분(색약 대응).
 * done 초록+체크 / late 노랑+시계 / missed 빨강+! / open 빈 원 / planned 점선 원
 */
export function StatusIcon({ status, size = 14, className = "", label = true }: Props) {
  const common = { width: size, height: size, viewBox: "0 0 16 16", className };
  const a11y = label ? { role: "img", "aria-label": STATUS_LABEL[status] } : { "aria-hidden": true };
  switch (status) {
    case "done":
      return (
        <svg {...common} {...a11y}>
          <circle cx="8" cy="8" r="8" fill="#1E9E6A" />
          <path d="M4.5 8.2l2.3 2.3 4.7-4.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "late":
      return (
        <svg {...common} {...a11y}>
          <circle cx="8" cy="8" r="8" fill="#C98A00" />
          <path d="M8 4.5V8l2.3 1.6" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case "missed":
      return (
        <svg {...common} {...a11y}>
          <circle cx="8" cy="8" r="8" fill="#D64545" />
          <path d="M8 4v5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <circle cx="8" cy="11.8" r="1.1" fill="#fff" />
        </svg>
      );
    case "open":
      return (
        <svg {...common} {...a11y}>
          <circle cx="8" cy="8" r="7" fill="#fff" stroke="#6B7684" strokeWidth="1.8" />
        </svg>
      );
    case "planned":
    default:
      return (
        <svg {...common} {...a11y}>
          <circle cx="8" cy="8" r="7" fill="#fff" stroke="#8C97A4" strokeWidth="1.6" strokeDasharray="2.2 1.8" />
        </svg>
      );
  }
}
