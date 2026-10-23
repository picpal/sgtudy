import { clampCp } from "@/components/room-new/validate";
import type { CallRounds } from "./rounds";
import type { RoundsModel } from "./schema";

/*
 * AI_INTERVIEW_MOCK=1 회차 대본(D34) — 키 없이 로컬·E2E·DOM 확인용. 결정적: 회차 표의 라벨로 제목·과제를 만든다.
 * 발화에 "장애 테스트" 가 있으면 503 흉내, "부족 테스트" 면 회차를 2개 덜 내서 서버 보정(padded)을 보여 준다
 */
export const mockCallRounds: CallRounds = async ({ state }) => {
  const said = state.userLines.join("\n");
  if (said.includes("장애 테스트")) return { ok: false, status: 529 };
  const topic = clampCp(state.draft.title, 12);
  const n = state.schedule.rounds.length - (said.includes("부족 테스트") ? 2 : 0);
  const period = state.schedule.cadenceDays === 7 ? "이번 주" : "이번 회차";
  const output: RoundsModel = {
    rounds: state.schedule.rounds.slice(0, Math.max(0, n)).map((r) => ({
      title: `${topic} ${r.label}`,
      goalMd: `${period} 목표: ${r.label} 범위를 익혀요\n- 핵심 개념 정리\n- 연습 문제`,
      tasks: [
        { title: `${r.label} 핵심 정리`, descriptionMd: "정리한 내용을 글로 올려요" },
        { title: `${r.label} 문제 풀기`, descriptionMd: "푼 문제와 오답을 정리해 올려요" },
      ],
    })),
  };
  return { ok: true, output, usage: { in: 0, out: 0, cached: 0 }, model: "mock" };
};
