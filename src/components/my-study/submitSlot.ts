"use client";

import { createContext, useContext } from "react";

/** 과제 상세의 「과제 제출」·「시험 응시」 카드가 들어갈 자리 — 방 화면이 본문 카드 아래 형제 칸을 연다.
 *  undefined = 자리를 여는 화면이 없다(제자리에 그린다) · null = 자리가 아직 붙지 않았다(잠깐 그리지 않는다) */
const Ctx = createContext<HTMLElement | null | undefined>(undefined);
export const SubmitSlotProvider = Ctx.Provider;
export const useSubmitSlot = () => useContext(Ctx);
