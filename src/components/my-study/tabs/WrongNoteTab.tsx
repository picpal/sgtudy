"use client";

import { useState } from "react";
import type { ToastMsg } from "@/components/ui/Toast";
import { fetchWrongNote } from "@/lib/api/wrongNote";
import { useNoteRound } from "../useNoteRound";
import { useWrongNote } from "../useWrongNote";
import { WrongNoteError, WrongNoteList, WrongNoteLoading } from "../WrongNoteList";
import { toNoteStudies, type RoundPeriods } from "../wrongNote";

type Props = {
  slug: string;
  /** 승인 대기 — 받지 않고 안내만(공지와 같다) */
  viewerPending: boolean;
  toast: (m: ToastMsg) => void;
  /** 회차 기간(커리큘럼 루트 노드) — 카드·상세 머리의 기간 줄 */
  periods?: RoundPeriods;
};

/** 오답노트 탭 (스펙 §6.1 · D22~) — 회차 카드 → ?round= 상세. 본문은 내 과제와 같은 WrongNoteList */
export function WrongNoteTab({ slug, viewerPending, toast, periods }: Props) {
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
  const nav = useNoteRound();
  const pending = viewerPending || serverPending;

  if (!pending && !w.studies) return w.error && !w.loading ? <WrongNoteError onRetry={w.refetch} /> : <WrongNoteLoading />;
  return (
    <WrongNoteList
      studies={w.studies ?? []}
      pending={pending}
      scope="room"
      busy={w.busy}
      onPractice={w.practice}
      onMaster={w.master}
      onBookmark={w.bookmark}
      round={nav.round}
      onOpenRound={nav.open}
      onBack={nav.back}
      periods={periods}
    />
  );
}
