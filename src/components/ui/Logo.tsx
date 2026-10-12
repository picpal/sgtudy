import Link from "next/link";
import { routes } from "@/lib/routes";

export function Logo() {
  return (
    <Link
      href={routes.home()}
      className="flex items-center gap-[10px] pr-2 text-ink hover:text-ink"
      aria-label="슥터디 홈"
    >
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <rect width="30" height="30" rx="9" fill="#1B2230" />
        <path
          d="M8 11c3-3 7-3 10 0M8 19c3-3 7-3 10 0"
          fill="none"
          stroke="#5FD3B8"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[20px] font-bold tracking-[-0.02em]">슥터디</span>
    </Link>
  );
}
