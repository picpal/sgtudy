"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import type { Me } from "@/lib/api/types";
import { routes } from "@/lib/routes";

/** 로그인 사용자. null = 비로그인. 루트 레이아웃이 me_get 으로 채운다. 로그인/로그아웃 후 router.refresh() 로 갱신. */
const MeContext = createContext<Me | null | undefined>(undefined);
/** 헤더 "내 스터디" 링크 — 레이아웃이 me_studies 첫 스터디로 채운다(myStudyHrefOf). 없으면 /my-study */
const MyStudyHrefContext = createContext<string>(routes.myStudy());

export function MeProvider({ me, myStudyHref, children }: { me: Me | null; myStudyHref?: string; children: ReactNode }) {
  return createElement(
    MeContext.Provider,
    { value: me },
    createElement(MyStudyHrefContext.Provider, { value: myStudyHref ?? routes.myStudy() }, children),
  );
}

export function useMe(): Me | null {
  const v = useContext(MeContext);
  if (v === undefined) throw new Error("useMe() must be used inside <MeProvider>");
  return v;
}

export function useMyStudyHref(): string {
  return useContext(MyStudyHrefContext);
}
