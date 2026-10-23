"use client";

import { useRouter } from "next/navigation";
import type { ToastMsg } from "@/components/ui/Toast";
import { toApiError } from "@/lib/api/errors";
import { leaderErrorText, openRecruit, openRecruitNote } from "@/lib/api/leader";
import type { RoomDetail } from "@/lib/api/types";

/** 「모집 시작」 확인 창 문구 — 그룹장 패널·내 스터디 준비중 막대 공용 */
export const openRecruitConfirm = (d: Pick<RoomDetail, "isPublic" | "joinMode">) => ({
  title: "모집을 시작할까요?",
  body: `모집을 시작하면 ${openRecruitNote(d)}. 모집중에도 방 설정에서 공개 여부·참가 방식을 바꿀 수 있어요.`,
  confirmLabel: "모집 시작",
});

/**
 * 준비중 → 모집중 (room_open_recruit). 성공하면 토스트 + router.refresh(상태 배지·사이드바·탭 재동기화), 실패하면 오류 토스트.
 * 돌려주는 함수는 성공 여부를 낸다 — 확인 창 닫기·busy 는 부르는 쪽이 맡는다
 */
export function useOpenRecruit(slug: string, toast: (m: ToastMsg) => void, onDetail?: (d: RoomDetail) => void) {
  const router = useRouter();
  return async () => {
    try {
      const d = await openRecruit(slug); // onDetail?.(await …) 로 쓰면 onDetail 이 없을 때 호출 자체가 빠진다
      onDetail?.(d);
      toast({ text: "모집을 시작했어요", tone: "ok" });
      router.refresh();
      return true;
    } catch (e) {
      const err = toApiError(e);
      toast({ text: leaderErrorText(err.code, err.message), tone: "bad" });
      return false;
    }
  };
}
