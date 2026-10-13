import Link from "next/link";
import { routes } from "@/lib/routes";
import { emptyCopy } from "./empty-copy";
import type { StatusFilter, Tab } from "./FilterBar";

type Props = { q: string; tab: Tab; status: StatusFilter; tagLabels: string[]; onReset: () => void; onBrowse: () => void };

const cta = "mt-2 flex h-11 items-center rounded-[12px] bg-navy px-[18px] text-[14px] font-semibold text-white hover:text-white";

export function EmptyState({ q, tab, status, tagLabels, onReset, onBrowse }: Props) {
  const { title, body, action } = emptyCopy(q.trim(), tab, status, tagLabels);
  return (
    <div className="mb-6 flex flex-col items-center gap-3 rounded-[20px] border border-dashed border-line-dash bg-surface px-6 py-16 text-center">
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
        <rect x="8" y="12" width="40" height="32" rx="8" stroke="#9FB3AD" strokeWidth="2" />
        <path d="M18 24h20M18 32h12" stroke="#9FB3AD" strokeWidth="2" strokeLinecap="round" />
        <circle cx="44" cy="14" r="7" fill="#DDF4EE" stroke="#0D7A64" strokeWidth="2" />
        <path d="M44 11v6M41 14h6" stroke="#0D7A64" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <p className="m-0 text-[17px] font-semibold">{title}</p>
      <p className="m-0 text-[14px] text-muted">{body}</p>
      {action === "create" && (
        <Link href={routes.createRoom()} className={cta}>
          방 만들기
        </Link>
      )}
      {action === "browse" && (
        <button type="button" onClick={onBrowse} className={cta}>
          방 둘러보기
        </button>
      )}
      {action === "reset" && (
        <button type="button" onClick={onReset} className={cta}>
          필터 초기화
        </button>
      )}
    </div>
  );
}
