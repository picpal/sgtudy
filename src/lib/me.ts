"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import type { Me } from "@/lib/api/types";

/** 로그인 사용자. null = 비로그인. 루트 레이아웃이 me_get 으로 채운다. 로그인/로그아웃 후 router.refresh() 로 갱신. */
const MeContext = createContext<Me | null | undefined>(undefined);

export function MeProvider({ me, children }: { me: Me | null; children: ReactNode }) {
  return createElement(MeContext.Provider, { value: me }, children);
}

export function useMe(): Me | null {
  const v = useContext(MeContext);
  if (v === undefined) throw new Error("useMe() must be used inside <MeProvider>");
  return v;
}
