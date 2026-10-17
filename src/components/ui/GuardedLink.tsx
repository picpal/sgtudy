"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { guardNavigate } from "@/lib/leaveGuard";

/**
 * 앱 안 링크 — 진행목표 편집 화면 등에 저장 안 한 수정이 있으면 이동 전에 묻는다(leaveGuard, Q2-1).
 * 가드가 없을 때는 next/link 그대로. onNavigate 는 클라이언트 이동에만 불린다(새 탭·외부 주소는 그대로).
 * 편집 화면과 함께 보이는 조각(my-study·ui·room-view·room-settings)은 next/link 대신 이것을 쓴다 — GuardedLink.test 가 고정.
 */
export function GuardedLink({ onNavigate, ...props }: ComponentProps<typeof Link> & { href: string }) {
  return (
    <Link
      {...props}
      onNavigate={(e) => {
        guardNavigate(props.href, e);
        onNavigate?.(e);
      }}
    />
  );
}
