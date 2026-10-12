import type { Room } from "@/data/room-view";

export function GlanceCard({ glance }: { glance: Room["glance"] }) {
  return (
    <div className="flex flex-col gap-[10px] rounded-[20px] border border-line bg-surface-2 px-5 py-[18px]">
      <div className="text-[14px] font-bold">한눈에 보기</div>
      <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-y-2 text-[13px]">
        <dt className="text-muted">회차</dt>
        <dd className="font-medium">{glance.rounds}</dd>
        <dt className="text-muted">과제</dt>
        <dd className="font-medium">{glance.tasks}</dd>
        <dt className="text-muted">제출 방식</dt>
        <dd className="font-medium">마크다운 · 링크 · 파일</dd>
      </dl>
    </div>
  );
}
