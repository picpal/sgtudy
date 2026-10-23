"use client";

import { WrongNoteError, WrongNoteList, WrongNoteLoading } from "@/components/my-study/WrongNoteList";
import type { useWrongNote } from "@/components/my-study/useWrongNote";
import { TasksEmpty } from "./TasksEmpty";

type Props = {
  /** TasksScreen 이 든 훅 — 과제 보기로 갔다 와도(이 컴포넌트가 내려가도) 받은 목록이 남는다(D19) */
  notes: ReturnType<typeof useWrongNote>;
  /** ?study= — 그 스터디 섹션만(D20) */
  study: string;
};

/** 내 과제 「오답노트」 보기 본문(오답노트 스펙 §6.5) — 모든 스터디의 오답을 스터디 h2 → 회차 → 시험 카드로. 방 탭과 같은 WrongNoteList */
export function TasksNotesView({ notes, study }: Props) {
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
      // 묶음 채점 막대를 본문 카드(main px-7 · ≤640 px-2) 끝까지
      barInset="-mx-7 px-7 max-sm:-mx-2 max-sm:px-2"
    />
  );
}
