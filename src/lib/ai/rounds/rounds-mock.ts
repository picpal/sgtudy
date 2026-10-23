import { clampCp } from "@/components/room-new/validate";
import type { CallRounds } from "./rounds";
import type { RoundsModel } from "./schema";

/*
 * AI_INTERVIEW_MOCK=1 회차 대본(D34) — 키 없이 로컬·E2E·DOM 확인용. 결정적: 쓸 회차(write)의 라벨로 제목·과제를 만든다.
 * 발화에 "장애 테스트" 가 있으면 503 흉내. "부족 테스트" 면 첫 요청에서 끝 2회차를 빼서 재요청 경로(D40)를,
 * "계속 부족 테스트" 면 매번 끝 2회차를 빼서 재요청 뒤에도 빈 채움 회차(padded)가 남는 경로를 보여 준다
 */
export const mockCallRounds: CallRounds = async ({ state, write }) => {
  const said = state.userLines.join("\n");
  if (said.includes("장애 테스트")) return { ok: false, status: 529 };
  const topic = clampCp(state.draft.title, 12);
  const first = write.length === state.schedule.rounds.length;
  const drop = said.includes("계속 부족 테스트") || (said.includes("부족 테스트") && first) ? 2 : 0;
  const output: RoundsModel = {
    rounds: write.slice(0, Math.max(0, write.length - drop)).map((r) => ({
      index: r.index + 1,
      title: `${topic} ${r.label}`,
      goalMd: `${r.label} 범위를 익혀요\n- 핵심 개념 정리\n- 연습 문제`,
      tasks: [
        { title: `${r.label} 핵심 정리`, descriptionMd: "핵심 개념을 5줄로 정리해 글로 올려요. 헷갈린 부분 하나를 질문으로 남겨요" },
        { title: `${r.label} 문제 풀기`, descriptionMd: "푼 문제 수와 틀린 문제 번호를 적고, 틀린 이유를 3줄씩 정리해 올려요" },
      ],
    })),
  };
  return { ok: true, output, usage: { in: 0, out: 0, cached: 0 }, model: "mock" };
};
