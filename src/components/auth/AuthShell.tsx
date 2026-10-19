import type { ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";

/** 로그인·온보딩·초대 공용 껍데기 — 가운데 420px 카드, 390px 에서 좌우 16px */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center px-4 pb-16 pt-10 text-ink">
      <Logo />
      <main className="mt-8 flex w-full max-w-[420px] flex-col gap-5 rounded-[20px] border border-line bg-surface p-7 shadow-[0_10px_30px_rgba(27,34,48,.06)] max-sm:p-5">
        <div>
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.02em]">{title}</h1>
          {subtitle && <p className="mb-0 mt-[6px] text-[14px] leading-[1.6] text-muted [overflow-wrap:anywhere]">{subtitle}</p>}
        </div>
        {children}
      </main>
    </div>
  );
}
