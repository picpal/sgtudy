import Link from "next/link";
import { routes } from "@/lib/routes";
import type { Tab } from "./FilterBar";

type Props = { q: string; tab: Tab };

const BODY = "채팅방 만들듯 30초면 충분해요. 첫 스터디를 열어 보세요.";

/** 빈 상태 문구 우선순위 — spec §4 */
function copy(q: string, tab: Tab): { title: string; body: string } {
  if (q) return { title: `‘${q}’ 검색 결과가 없어요`, body: "다른 키워드나 태그로 다시 찾아보세요." };
  if (tab === "created") return { title: "아직 만든 방이 없어요", body: BODY };
  if (tab === "mine") return { title: "참가한 방이 없어요", body: BODY };
  return { title: "조건에 맞는 방이 없어요", body: BODY };
}

export function EmptyState({ q, tab }: Props) {
  const { title, body } = copy(q.trim(), tab);
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
      <Link
        href={routes.createRoom()}
        className="mt-2 flex h-11 items-center rounded-[12px] bg-navy px-[18px] text-[14px] font-semibold text-white hover:text-white"
      >
        방 만들기
      </Link>
    </div>
  );
}
