import { StatusIcon } from "@/components/ui/StatusIcon";
import { STATUS_LABEL, type TaskStatus } from "@/lib/types";

const ORDER: TaskStatus[] = ["done", "late", "missed", "open", "planned"];

export function Legend() {
  return (
    <div className="mt-3 flex shrink-0 flex-wrap gap-4 text-[12px] text-ink-3">
      {ORDER.map((st) => (
        <span key={st} className="inline-flex items-center gap-[5px]">
          <StatusIcon status={st} size={13} label={false} />
          {STATUS_LABEL[st]}
        </span>
      ))}
      <span className="inline-flex items-center gap-[5px]">
        <span className="rounded-[5px] bg-ink px-[5px] py-px text-[10px] font-bold text-white max-sm:h-[7px] max-sm:w-[7px] max-sm:rounded-full max-sm:p-0 max-sm:text-[0px] max-sm:leading-none">2주</span>회차 시작
      </span>
      <span className="inline-flex items-center gap-[5px]">
        <span className="h-3 w-[26px] rounded-[4px] border border-dashed border-faint bg-surface" />
        시작 전 과제
      </span>
      <span className="inline-flex items-center gap-[5px]">
        <span className="h-3 w-[26px] rounded-[4px] border border-[#C98A00] [background:repeating-linear-gradient(135deg,#FBEFD3_0_4px,#FFF_4px_7px)]" />
        승인 대기 스터디
      </span>
      <span className="text-muted">· 막대 = 과제 기간<span className="max-sm:hidden">(클릭하면 상세)</span>, 아이콘은 마감일에 표시</span>
    </div>
  );
}
