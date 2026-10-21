/**
 * 방 정보 목록(기간·상태·참가 방식…) 공통 틀 — 내 스터디 헤더(StudyHeaderInfo)·방 화면(RoomInfo)이 같이 쓴다.
 * 데스크톱은 라벨 150px 칸 그대로. ≤640 은 라벨 칸을 96px 로 좁혀 값이 넓게 한 줄에 들어가게 하고(반폭 라벨 칸 때문에 날짜가 토큰 중간에서 꺾였다),
 * 여러 줄 값에서 라벨이 가운데로 떠 보이지 않게 첫 줄(28px)에 맞춘다.
 */
export const INFO_DL =
  "grid grid-cols-[150px_minmax(0,1fr)] items-center gap-x-3 gap-y-[14px] text-[14px] max-sm:grid-cols-[96px_minmax(0,1fr)] max-sm:items-start max-sm:gap-x-2 max-sm:gap-y-[10px] max-sm:[&>dt]:min-h-7 max-sm:[&>dd]:min-h-7 max-sm:[&>dd]:leading-7 max-sm:[&>dd_*]:leading-normal";

/** "2026.10.14(수) – 12.31(목)" 을 날짜 단위로 묶어 "12.31(" / "목)" 처럼 토큰 중간에서 줄이 바뀌지 않게 한다 */
export function PeriodText({ period }: { period: string }) {
  const parts = period.split(" – ");
  return (
    <span>
      {parts.map((p, i) => (
        // 줄바꿈 자리는 대시 뒤 공백 하나뿐 — 대시는 앞 날짜에 붙여 다음 줄 첫머리에 오지 않게
        <span key={i}>
          {i > 0 && " "}
          <span className="whitespace-nowrap">{i < parts.length - 1 ? `${p} –` : p}</span>
        </span>
      ))}
    </span>
  );
}
