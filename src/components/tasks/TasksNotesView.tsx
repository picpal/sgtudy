"use client";

import { WrongNoteError, WrongNoteList, WrongNoteLoading } from "@/components/my-study/WrongNoteList";
import type { useWrongNote } from "@/components/my-study/useWrongNote";
import type { RoundPeriods } from "@/components/my-study/wrongNote";
import { TasksEmpty } from "./TasksEmpty";

type Props = {
  /** TasksScreen 이 든 훅 — 과제 보기로 갔다 와도(이 컴포넌트가 내려가도) 받은 목록이 남는다(D19) */
  notes: ReturnType<typeof useWrongNote>;
  /** ?study= — 그 스터디 섹션만(D20) */
  study: string;
  /** 열린 회차(?round=) · 열기 · 닫기 — TasksScreen 의 useNoteRound */
  round: string | null;
  onOpenRound: (id: string) => void;
  onBack: () => void;
  /** me_tasks 회차 기간 — 이탈 방 회차는 없다(기간 줄을 뺀다) */
  periods: RoundPeriods;
};

/** 내 과제 「오답노트」 보기 본문(오답노트 스펙 §6.5 · D22~) — 스터디 h2 → 회차 카드 → ?round= 상세. 방 탭과 같은 WrongNoteList */
export function TasksNotesView({ notes, study, round, onOpenRound, onBack, periods }: Props) {
  if (!notes.studies) return notes.error && !notes.loading ? <WrongNoteError onRetry={notes.refetch} /> : <WrongNoteLoading />;
  if (notes.studies.length === 0) return <TasksEmpty kind="noStudy" />;
  return (
    <WrongNoteList
      studies={notes.studies}
      scope="all"
      studyFilter={study}
      busy={notes.busy}
      onPractice={notes.practice}
      onMaster={notes.master}
      round={round}
      onOpenRound={onOpenRound}
      onBack={onBack}
      periods={periods}
      // 묶음 채점 막대를 본문 카드(main px-7 · ≤640 px-2) 끝까지
      barInset="-mx-7 px-7 max-sm:-mx-2 max-sm:px-2"
    />
  );
}
