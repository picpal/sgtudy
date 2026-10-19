"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ReasonField } from "@/components/ui/ReasonField";
import type { MoreMenuItem } from "@/components/ui/MoreMenu";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { actionOf, applyMembership, applyRoom, cancelApplication, fetchRoomDetail, joinRoom, leaveRoom, roomReturnTo, toRoom, toSidebarRoom } from "@/lib/api/room-view";
import { useRefetchOnFocus } from "@/lib/useRefetchOnFocus";
import type { MembershipResult, RoomDetail, RoomListResponse } from "@/lib/api/types";
import { useMe } from "@/lib/me";
import { routes } from "@/lib/routes";
import { RoomSidebar } from "./RoomSidebar";
import { DEFAULT_FILTERS, type HomeFilters } from "@/components/main/homeUrl";
import { RoomInfo } from "./RoomInfo";
import { JoinCard } from "./JoinCard";
import { GlanceCard } from "./GlanceCard";
import { LeaderPanel } from "./LeaderPanel";
import { cancelConfirmBody, menuItemsOf, roomMoreItems } from "./moreItems";

/** invite: ?invite= 로 연 비공개 방의 토큰 — 참가/신청 RPC 와 로그인 복귀 주소에 그대로 이어 붙인다 */
/** filters: 둘러보기에서 이어받은 필터 — 왼쪽 목록(list)이 이 조건으로 조회됐다 (시나리오 QA #19) */
export function RoomViewScreen({ detail, list, invite, filters = DEFAULT_FILTERS }: { detail: RoomDetail; list: RoomListResponse; invite?: string; filters?: HomeFilters }) {
  const me = useMe();
  const router = useRouter();
  const [dto, setDto] = useState(detail);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"leave" | "cancel" | "apply" | null>(null);
  const [message, setMessage] = useState(""); // 참가 신청 한마디 (D4 — 선택)
  const [toast, setToast] = useState<ToastMsg>(null);
  const room = useMemo(() => toRoom(dto, dto.today, me?.id ?? null), [dto, me]);
  const act = actionOf(dto);
  const sidebar = useMemo(() => list.items.map((d) => toSidebarRoom(d, list.today)), [list]);
  const closeToast = useCallback(() => setToast(null), []);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const returnTo = roomReturnTo(dto.slug, invite);
  // 승인 대기 중에 열어 둔 방 화면 — 창으로 돌아오면 다시 불러 승인(참가중)을 반영한다 (시나리오 QA #9). 화면이 dto 를 state 로 들고 있어 router.refresh 만으로는 안 바뀐다
  useRefetchOnFocus(act === "pending", () => {
    fetchRoomDetail(dto.slug, undefined, invite)
      .then((d) => {
        setDto((prev) => ({ ...d, today: prev.today }));
        if (d.me?.state !== "pending") router.refresh(); // 옆 목록 표시·헤더
      })
      .catch(() => undefined);
  });

  const run = async (fn: () => Promise<MembershipResult>, okText: string) => {
    setBusy(true);
    try {
      const r = await fn();
      setDto((d) => applyMembership(d, r));
      setToast({ text: okText, tone: "ok" });
      router.refresh(); // 사이드바 mark·탭 카운트 재동기화
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "AUTH_REQUIRED") return router.push(routes.login(returnTo));
      if (err.code === "ONBOARDING_REQUIRED") return router.push(routes.onboarding(returnTo));
      setToast({ text: err.message, tone: "bad" });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  // 공유: 초대 토큰 없이 방 주소만 복사한다 (비공개 방 초대 링크는 그룹장 패널 LeaderPanel 이 복사한다)
  const share = async () => {
    try {
      await navigator.clipboard.writeText(new URL(routes.room(dto.slug), window.location.origin).href);
      setToast({ text: "링크를 복사했어요", tone: "ok" });
    } catch {
      setToast({ text: "링크를 복사하지 못했어요 · 주소창의 링크를 복사해 주세요", tone: "bad" });
    }
  };

  // 더보기: 내 스터디로 · 방 설정(그룹장) · 참가/신청 취소 (JoinCard 와 같은 확인 대화상자)
  const more: MoreMenuItem[] = menuItemsOf(roomMoreItems(act), dto.slug, (k) => (k === "leave" || k === "cancel") && setConfirm(k));

  return (
    // 한 페이지 스크롤 — 화면 높이에 가두지 않는다. 옆 목록은 화면에 다 들어갈 때만 붙는다(RoomSidebar)
    <div className="flex min-h-screen flex-col p-4">
      <AppHeader active="home" variant="card" bell={<NotificationBell />} />
      {/* ≤900(포함): 선택한 방이 먼저, 목록은 그 아래에서 접힌다 (Q1-08/Q3-07). Tailwind max-[901px] = width < 901 */}
      <div className="mx-auto flex w-full max-w-[1408px] flex-1 items-start gap-4 max-[901px]:flex-wrap max-[901px]:content-start">
        <RoomSidebar selected={dto.slug} items={sidebar} total={list.tabCounts.public} filters={filters} found={list.totalElements} tagLabels={filters.tags.map((t) => list.tagFacets.find((f) => f.slug === t)?.label ?? t)} />
        <main className="min-w-0 flex-[999_1_640px] self-stretch rounded-[20px] bg-surface px-7 pb-9 pt-7 max-[901px]:order-first max-sm:px-4">
          {/* 정보(460) + 간격(28) + 참가 카드(300) = 788 보다 좁으면 카드가 아래로 떨어진다 — 그땐 360 에 묶지 않고 두 카드를 나란히 (태블릿·좁은 PC) */}
          <div className="flex flex-wrap items-start gap-7 @container">
            <RoomInfo room={room} onShare={share} more={more} />
            <aside aria-label="참가 정보" className="flex max-w-[360px] flex-[1_1_300px] flex-col gap-[14px] @max-[788px]:grid @max-[788px]:max-w-none @max-[788px]:grid-cols-[repeat(auto-fit,minmax(280px,1fr))] @max-[788px]:items-start">
              <JoinCard
                room={room}
                act={act}
                busy={busy}
                loginHref={routes.login(returnTo)}
                onJoin={() => run(() => joinRoom(dto.slug, invite), "참가했어요")}
                onApply={() => {
                  setMessage("");
                  setConfirm("apply");
                }}
                onCancel={() => setConfirm(act === "leave" ? "leave" : "cancel")}
              />
              {act === "owner" && (
                <LeaderPanel
                  detail={dto}
                  toast={setToast}
                  onDetail={(d) => setDto((prev) => ({ ...prev, ...d, today: prev.today }))}
                  onMembership={(r) => setDto((d) => applyMembership(d, r))}
                />
              )}
              <GlanceCard glance={room.glance} />
            </aside>
          </div>
        </main>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "apply" ? "참가 신청할까요?" : confirm === "leave" ? "참가를 취소할까요?" : "신청을 취소할까요?"}
        body={
          confirm === "apply"
            ? "그룹장이 승인하면 참가가 확정되고 알림으로 알려 드려요."
            : confirm === "leave"
              ? "모집 기간에는 다시 참가할 수 있어요. 지정 과제 담당에서도 빠져요."
              : cancelConfirmBody(dto.archived)
        }
        confirmLabel={confirm === "apply" ? "참가 신청" : confirm === "leave" ? "참가 취소" : "신청 취소"}
        danger={confirm !== "apply"}
        busy={busy}
        onCancel={closeConfirm}
        onConfirm={() =>
          confirm === "apply"
            ? run(() => applyRoom(dto.slug, invite, message), "참가 신청했어요 · 그룹장이 승인하면 알려 드려요")
            : confirm === "leave"
              ? run(() => leaveRoom(dto.slug), "참가를 취소했어요")
              : run(() => cancelApplication(dto.slug), "신청을 취소했어요")
        }
      >
        {confirm === "apply" && <ReasonField value={message} onChange={setMessage} label="그룹장에게 한마디 (선택)" placeholder="자기소개나 참여 계획을 짧게 남겨 주세요" />}
      </ConfirmDialog>
      <Toast msg={toast} onClose={closeToast} />
    </div>
  );
}
