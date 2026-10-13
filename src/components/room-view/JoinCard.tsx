import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { routes } from "@/lib/routes";
import { type Action, type Room } from "@/data/room-view";
import { StatusBadge } from "./StatusBadge";

type Props = { room: Room; act: Action; busy?: boolean; onJoin: () => void; onApply: () => void; onCancel: () => void };

const DISABLED: Partial<Record<Action, [label: string, note: string]>> = {
  full: ["정원 마감", "자리가 생기면 다시 참가할 수 있어요"],
  activeClosed: ["모집 종료", "이미 진행 중인 스터디는 참가할 수 없어요"],
  ended: ["모집 종료", "종료된 스터디예요 · 기록은 계속 볼 수 있어요"],
};

const PRIMARY = "flex h-[50px] items-center justify-center gap-2 rounded-[25px] font-semibold text-white hover:text-white";
const SECONDARY = "flex h-11 items-center justify-center gap-[6px] rounded-[22px] border border-line-3 bg-surface text-[14px] font-medium text-ink";
const NOTE = "text-center text-[12px] text-muted";

function Cta({ room, act, busy, onJoin, onApply, onCancel }: Props) {
  const dis = DISABLED[act];
  if (dis) {
    return (
      <div className="flex flex-col gap-[6px]">
        <button type="button" disabled className="h-[50px] rounded-[25px] bg-slate-soft text-[15px] font-semibold text-muted">
          {dis[0]}
        </button>
        <span className={NOTE}>{dis[1]}</span>
      </div>
    );
  }
  switch (act) {
    case "login":
      return (
        <div className="flex flex-col gap-[6px]">
          <Link href={routes.login(routes.room(room.id))} className={`${PRIMARY} bg-navy text-[16px]`}>로그인하고 참가</Link>
          <span className={NOTE}>이메일 인증 코드로 바로 로그인할 수 있어요</span>
        </div>
      );
    case "join":
    case "apply":
      return (
        <div className="flex flex-col gap-[6px]">
          <button type="button" onClick={act === "join" ? onJoin : onApply} disabled={busy} className={`${PRIMARY} bg-navy text-[16px]`}>
            {act === "join" ? "참가하기" : "참가 신청"}
          </button>
          <span className={NOTE}>{act === "join" ? "바로 참가돼요 · 시작 전까지 언제든 취소할 수 있어요" : "그룹장이 승인하면 참가가 확정돼요"}</span>
        </div>
      );
    case "leave":
    case "pending": {
      const leave = act === "leave";
      return (
        <div className="flex flex-col gap-2">
          <div
            className="flex h-12 items-center justify-center gap-2 rounded-3xl text-[15px] font-semibold"
            style={leave ? { background: "#DDF4EE", color: "#0B6553" } : { background: "#FBEFD3", color: "#7A4F00" }}
          >
            {leave ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            )}
            {leave ? "참가 완료" : "승인 대기중"}
          </div>
          <button type="button" onClick={onCancel} disabled={busy} className={SECONDARY}>
            {leave ? "참가 취소" : "신청 취소"}
          </button>
          <span className={NOTE}>{leave ? "모집 기간에만 참가를 취소할 수 있어요" : "시작일까지 승인되지 않으면 신청이 자동 만료돼요"}</span>
        </div>
      );
    }
    case "joined":
      return (
        <div className="flex flex-col gap-[6px]">
          <Link href={routes.myStudy(room.id)} className={`${PRIMARY} bg-mint text-[15px]`}>
            참가중 · 내 스터디에서 보기
          </Link>
          <span className={NOTE}>과제 제출과 진척 확인은 내 스터디에서 해요</span>
        </div>
      );
    case "owner":
      return (
        <div className="flex flex-col gap-2">
          <Link href={routes.myStudy(room.id)} className={`${PRIMARY} bg-navy text-[15px]`}>
            내가 만든 방 · 관리하기
          </Link>
          {/* plan 06: 그룹장 패널(승인 대기 ${pendingCount}명 · 초대 링크 복사 · 모집 시작) */}
        </div>
      );
  }
}

export function JoinCard(props: Props) {
  const { room } = props;
  const recruit = room.status === "recruit";
  const rows = room.members;            // 어댑터가 내 pending 행까지 넣어 준다
  const capCur = room.capCur;           // 서버 값 그대로 (roomview §3.5)
  const full = capCur >= room.capMax;
  const minOk = room.minNeed === 0 || capCur >= room.minNeed;

  return (
    <div className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-5 shadow-[0_10px_30px_rgba(27,34,48,.06)]">
      <div className="flex items-center justify-between">
        <StatusBadge status={room.status} />
        <span className="text-[13px] font-semibold text-ink">{room.ddayLong}</span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-muted">참가 인원</span>
          <span className="text-[20px] font-bold">
            {capCur}
            <span className="text-[14px] font-medium text-muted"> / {room.capMax}명</span>
          </span>
        </div>
        <ProgressBar
          pct={Math.round((capCur / room.capMax) * 100)}
          height={8}
          track={recruit ? "#D6E2FA" : "#E2EAE7"}
          fill={full ? "#C9583A" : recruit ? "#3B6FE0" : "#12A386"}
        />
        {room.minNeed > 0 && (
          <span className="inline-flex items-center gap-[5px] text-[12px] font-medium" style={{ color: minOk ? "#0D7A64" : "#8A5A00" }}>
            {minOk ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5.5" />
                <circle cx="12" cy="16.5" r=".6" />
              </svg>
            )}
            {minOk ? `최소 ${room.minNeed}명 · 충족${full ? " · 정원 마감" : ""}` : `최소 ${room.minNeed}명 · ${room.minNeed - capCur}명 더 필요해요`}
          </span>
        )}
      </div>

      <div>
        <div className="mb-2 flex justify-between text-[13px] font-semibold">
          <span>참가자</span>
          <span className="font-medium text-muted">{recruit ? "참가 확정 순" : "참가자 목록"}</span>
        </div>
        {rows.length > 0 ? (
          <ul className="flex flex-col gap-[2px]">
            {rows.map((mb) => (
              <li key={mb.userId ?? mb.name} className={`flex items-center gap-[10px] rounded-[10px] px-2 py-[7px] ${mb.me ? "bg-[#F3F7FF]" : ""}`}>
                <Avatar name={mb.name} tone={mb.tone} size={30} pending={mb.pending} />
                <span className="flex min-w-0 flex-1 items-center gap-[6px]">
                  <span className={`whitespace-nowrap text-[14px] ${mb.me ? "font-bold" : "font-medium"} ${mb.pending ? "text-faint" : "text-ink"}`}>{mb.name}</span>
                  {mb.leader && (
                    <svg width="15" height="15" viewBox="0 0 24 24" role="img" aria-label="그룹장">
                      <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="#E7A913" stroke="#B07F00" strokeWidth="1.2" strokeLinejoin="round" />
                    </svg>
                  )}
                  {mb.me && <span className="rounded-md bg-blue-soft px-[6px] py-[1px] text-[11px] font-semibold text-blue-text">나</span>}
                  {mb.pending && <span className="rounded-md bg-slate-soft px-[6px] py-[1px] text-[11px] font-semibold text-ink-3">승인 대기</span>}
                </span>
                <span className="text-[12px] text-muted">{mb.leader ? "그룹장" : mb.pending ? "" : "참가자"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-[6px] rounded-[14px] border border-dashed border-line-dash px-[14px] py-[18px] text-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8C97A4" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
              <path d="M19 8v6M16 11h6" />
            </svg>
            <span className="text-[13px] font-semibold text-ink-2">아직 참가자가 없어요</span>
            <span className="text-[12px] text-muted">첫 번째 참가자가 되어 보세요</span>
          </div>
        )}
      </div>

      <Cta {...props} />
    </div>
  );
}
