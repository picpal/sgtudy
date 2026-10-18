"use client";

import { createContext, useContext } from "react";

/** 보관된 방인가 — 화면 깊은 곳(제출 카드 문구)이 "종료된" 대신 "보관된 스터디" 라 쓰게 (시나리오 QA #6). 기본 false */
const Ctx = createContext(false);
export const RoomArchivedProvider = Ctx.Provider;
export const useRoomArchived = () => useContext(Ctx);
