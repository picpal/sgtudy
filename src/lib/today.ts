"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";

/** 서버가 준 KST 오늘(YYYY-MM-DD). 루트 레이아웃이 meta_get 으로 1회 채우고, 화면은 응답 today 로 덮어쓸 수 있다. */
const TodayContext = createContext<string | null>(null);

export function TodayProvider({ today, children }: { today: string; children: ReactNode }) {
  return createElement(TodayContext.Provider, { value: today }, children);
}

export function useToday(): string {
  const v = useContext(TodayContext);
  if (!v) throw new Error("useToday() must be used inside <TodayProvider>");
  return v;
}
