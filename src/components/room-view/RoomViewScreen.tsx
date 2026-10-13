"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AppHeader } from "@/components/ui/AppHeader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { Toast, type ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { actionOf, applyMembership, applyRoom, cancelApplication, joinRoom, leaveRoom, roomReturnTo, toRoom, toSidebarRoom } from "@/lib/api/room-view";
import type { MembershipResult, RoomDetail, RoomListResponse } from "@/lib/api/types";
import { useMe } from "@/lib/me";
import { routes } from "@/lib/routes";
import { RoomSidebar } from "./RoomSidebar";
import { RoomInfo } from "./RoomInfo";
import { JoinCard } from "./JoinCard";
import { GlanceCard } from "./GlanceCard";

/** invite: ?invite= 로 연 비공개 방의 토큰 — 참가/신청 RPC 와 로그인 복귀 주소에 그대로 이어 붙인다 */
export function RoomViewScreen({ detail, list, invite }: { detail: RoomDetail; list: RoomListResponse; invite?: string }) {
  const me = useMe();
  const router = useRouter();
  const [dto, setDto] = useState(detail);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"leave" | "cancel" | null>(null);
  const [toast, setToast] = useState<ToastMsg>(null);
  const room = useMemo(() => toRoom(dto, dto.today, me?.id ?? null), [dto, me]);
  const act = actionOf(dto);
  const sidebar = useMemo(() => list.items.map((d) => toSidebarRoom(d, list.today)), [list]);
  const closeToast = useCallback(() => setToast(null), []);
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const returnTo = roomReturnTo(dto.slug, invite);

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

  return (
    <div className="flex min-h-screen flex-col p-4 min-[901px]:h-screen">
      <AppHeader active="home" variant="card" bell={<NotificationBell />} />
      <div className="mx-auto flex w-full min-h-0 max-w-[1408px] flex-1 gap-4 max-[900px]:flex-wrap">
        <RoomSidebar selected={dto.slug} items={sidebar} total={list.tabCounts.public} />
        <main className="thin-scroll min-h-0 min-w-0 flex-[999_1_640px] overflow-y-auto rounded-[20px] bg-surface px-7 pb-9 pt-7 max-[900px]:overflow-visible max-sm:px-4">
          <div className="flex flex-wrap items-start gap-7">
            <RoomInfo room={room} />
            <aside aria-label="참가 정보" className="flex max-w-[360px] flex-[1_1_300px] flex-col gap-[14px]">
              <JoinCard
                room={room}
                act={act}
                busy={busy}
                loginHref={routes.login(returnTo)}
                onJoin={() => run(() => joinRoom(dto.slug, invite), "참가했어요")}
                onApply={() => run(() => applyRoom(dto.slug, invite), "참가 신청했어요 · 그룹장이 승인하면 알려 드려요")}
                onCancel={() => setConfirm(act === "leave" ? "leave" : "cancel")}
              />
              <GlanceCard glance={room.glance} />
            </aside>
          </div>
        </main>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "leave" ? "참가를 취소할까요?" : "신청을 취소할까요?"}
        body={confirm === "leave" ? "모집 기간에는 다시 참가할 수 있어요. 지정 과제 담당에서도 빠져요." : "취소해도 모집 중이면 다시 신청할 수 있어요."}
        confirmLabel={confirm === "leave" ? "참가 취소" : "신청 취소"}
        danger
        busy={busy}
        onCancel={closeConfirm}
        onConfirm={() => (confirm === "leave" ? run(() => leaveRoom(dto.slug), "참가를 취소했어요") : run(() => cancelApplication(dto.slug), "신청을 취소했어요"))}
      />
      <Toast msg={toast} onClose={closeToast} />
    </div>
  );
}
