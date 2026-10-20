import { GuardedLink as Link } from "@/components/ui/GuardedLink";
import { Avatar } from "@/components/ui/Avatar";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { mmdd } from "@/lib/api/format";
import { routes } from "@/lib/routes";
import { MEMBERSHIP_LABEL } from "@/lib/types";
import { type Action, type Room, type RoomMember } from "@/data/room-view";
import { StatusBadge } from "./StatusBadge";

/** loginHref: 로그인 후 돌아올 주소(초대 토큰 포함)까지 담은 /login 링크 */
type Props = { room: Room; act: Action; busy?: boolean; loginHref: string; onJoin: () => void; onApply: () => void; onCancel: () => void };

const DISABLED: Partial<Record<Action, [label: string, note: string]>> = {
  full: ["정원 마감", "자리가 생기면 다시 참가할 수 있어요"],
  activeClosed: ["모집 종료", "진행중인 스터디예요 · 그룹장에게 초대 코드를 받으면 참가할 수 있어요"],
  ended: ["모집 종료", "종료된 스터디예요 · 기록은 계속 볼 수 있어요"],
  inactive: ["참가할 수 없어요", "이탈 처리된 멤버예요 · 그룹장에게 문의해 주세요"],
  archived: ["보관된 스터디", "그룹장이 보관했어요 · 기록만 볼 수 있어요"],
};

const ARCHIVED_PENDING_NOTE = "그룹장이 보관했어요 · 승인 대기 중인 신청은 취소할 수 있어요";

const PRIMARY = "flex h-[50px] items-center justify-center gap-2 rounded-[25px] font-semibold text-white hover:text-white disabled:opacity-60";
const SECONDARY = "flex h-11 items-center justify-center gap-[6px] rounded-[22px] border border-line-3 bg-surface text-[14px] font-medium text-ink";
const NOTE = "text-center text-[12px] text-muted";

function Cta({ room, act, busy, loginHref, onJoin, onApply, onCancel }: Props) {
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
          <Link href={loginHref} className={`${PRIMARY} bg-navy text-[16px]`}>로그인하고 참가</Link>
          <span className={NOTE}>이메일과 비밀번호로 로그인 · 처음이면 회원가입</span>
        </div>
      );
    case "join":
    case "apply":
      return (
        <div className="flex flex-col gap-[6px]">
          <button type="button" onClick={act === "join" ? onJoin : onApply} disabled={busy} className={`${PRIMARY} bg-navy text-[16px]`}>
            {act === "join" ? "참가하기" : "참가 신청"}
          </button>
          {room.status === "active" ? (
            <>
              <span className={NOTE}>진행중인 스터디예요 · 오늘 이후 마감인 과제부터 함께해요{room.extraUntil ? ` · ${mmdd(room.extraUntil)}까지 모집` : ""}</span>
              <span className={NOTE}>참가 뒤에는 취소 대신 탈퇴 요청으로 나갈 수 있어요</span>
            </>
          ) : (
            <span className={NOTE}>{act === "join" ? "바로 참가돼요 · 시작 전까지 언제든 취소할 수 있어요" : "그룹장이 승인하면 참가가 확정돼요"}</span>
          )}
        </div>
      );
    case "pending":
      // 백로그 F①: 보관된 방에 남은 승인 대기 — 보관 안내와 함께 신청만 취소할 수 있다
      if (room.archived) {
        return (
          <div className="flex flex-col gap-2">
            <button type="button" disabled className="h-[50px] rounded-[25px] bg-slate-soft text-[15px] font-semibold text-muted">
              {DISABLED.archived![0]}
            </button>
            <button type="button" onClick={onCancel} disabled={busy} className={SECONDARY}>
              신청 취소
            </button>
            <span className={NOTE}>{ARCHIVED_PENDING_NOTE}</span>
          </div>
        );
      }
    // fallthrough
    case "leave": {
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
            {leave ? MEMBERSHIP_LABEL.joined : MEMBERSHIP_LABEL.pending}
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
            {MEMBERSHIP_LABEL.joined} · 내 스터디에서 보기
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
          {/* 그룹장 패널(모집 시작·초대 링크·승인 대기)은 이 카드 아래 LeaderPanel 로 따로 붙는다 (RoomViewScreen) */}
        </div>
      );
  }
}

function MemberRow({ mb }: { mb: RoomMember }) {
  return (
    <li className={`flex items-center gap-[10px] rounded-[10px] px-2 py-[7px] ${mb.me ? "bg-[#F3F7FF]" : ""}`}>
      <Avatar name={mb.name} tone={mb.tone} id={mb.userId} size={30} pending={mb.pending} />
      <span className="flex min-w-0 flex-1 items-center gap-[6px]">
        <span className={`whitespace-nowrap text-[14px] ${mb.me ? "font-bold" : "font-medium"} ${mb.pending ? "text-faint" : "text-ink"}`}>{mb.name}</span>
        {mb.leader && (
          <svg width="15" height="15" viewBox="0 0 24 24" role="img" aria-label="그룹장">
            <path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="#E7A913" stroke="#B07F00" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        )}
        {mb.me && <span className="rounded-md bg-blue-soft px-[6px] py-[1px] text-[11px] font-semibold text-blue-text">나</span>}
        {mb.pending && <span className="rounded-md bg-slate-soft px-[6px] py-[1px] text-[11px] font-semibold text-ink-3">{MEMBERSHIP_LABEL.pending}</span>}
      </span>
      <span className="text-[12px] text-muted">{mb.leader ? "그룹장" : mb.pending ? "" : "참가자"}</span>
    </li>
  );
}

export function JoinCard(props: Props) {
  const { room } = props;
  const recruit = room.status === "recruit";
  // 어댑터가 내 pending 행까지 넣어 준다 → 확정 참가자와 승인 대기를 나눠 보여 준다 (Q2-23)
  const rows = room.members.filter((m) => !m.pending);
  const waiting = room.members.filter((m) => m.pending);
  const capCur = room.capCur;           // 서버 값 그대로 (roomview §3.5)
  const full = capCur >= room.capMax;
  const minOk = room.minNeed === 0 || capCur >= room.minNeed;

  return (
    <div className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-5 shadow-[0_10px_30px_rgba(27,34,48,.06)]">
      <div className="flex items-center justify-between gap-3">
        <StatusBadge status={room.status} draft={room.draft} archived={room.archived} />
        <span className="min-w-0 text-right text-[13px] font-semibold leading-[1.4] text-ink">{room.ddayLong}</span>
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
            {rows.map((mb) => <MemberRow key={mb.userId ?? mb.name} mb={mb} />)}
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

      {waiting.length > 0 && (
        <div>
          <div className="mb-2 flex justify-between text-[13px] font-semibold">
            <span>승인 대기</span>
            <span className="font-medium text-muted">그룹장 승인 전 · 인원에 포함 안 됨</span>
          </div>
          <ul className="flex flex-col gap-[2px]">
            {waiting.map((mb) => <MemberRow key={mb.userId ?? mb.name} mb={mb} />)}
          </ul>
        </div>
      )}

      <Cta {...props} />
    </div>
  );
}
