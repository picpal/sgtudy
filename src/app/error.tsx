"use client";

import { useEffect } from "react";
import { routes } from "@/lib/routes";

export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-[480px] flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <p className="m-0 text-[15px] font-semibold text-ink">화면을 불러오지 못했어요</p>
      <p className="m-0 text-[13px] text-muted">잠시 후 다시 시도해 주세요.</p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => retry()} className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white">
          다시 시도
        </button>
        <a href={routes.home()} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
          홈으로
        </a>
      </div>
    </main>
  );
}
