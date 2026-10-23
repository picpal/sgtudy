"use client";

import { useState } from "react";
import type { ToastMsg } from "@/components/ui/Toast";
import { fetchWrongNote } from "@/lib/api/wrongNote";
import { useWrongNote } from "../useWrongNote";
import { WrongNoteError, WrongNoteList, WrongNoteLoading } from "../WrongNoteList";
import { toNoteStudies } from "../wrongNote";

type Props = {
  slug: string;
  /** 승인 대기 — 받지 않고 안내만(공지와 같다) */
  viewerPending: boolean;
  toast: (m: ToastMsg) => void;
};

/** 오답노트 탭 (스펙 §6.1) — 이 방에서 내가 제출한 시험의 오답을 회차별로. 본문은 내 과제와 같은 WrongNoteList */
export function WrongNoteTab({ slug, viewerPending, toast }: Props) {
  // 서버도 승인 대기면 viewer: "pending" 으로 빈 응답을 준다 — 화면 정보보다 늦게 바뀐 경우
  const [serverPending, setServerPending] = useState(false);
  const w = useWrongNote(
    () =>
      fetchWrongNote(slug).then((v) => {
        setServerPending(v.viewer === "pending");
        return toNoteStudies(v, slug);
      }),
    [slug],
    { toast, enabled: !viewerPending },
  );
  const pending = viewerPending || serverPending;

  if (!pending && !w.studies) return w.error && !w.loading ? <WrongNoteError onRetry={w.refetch} /> : <WrongNoteLoading />;
  return <WrongNoteList studies={w.studies ?? []} pending={pending} scope="room" busy={w.busy} onPractice={w.practice} onMaster={w.master} />;
}
