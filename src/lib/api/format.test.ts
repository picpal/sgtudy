import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/date";
import { curIndexOf, curOf, ddayOf, endPart, glanceOf, periodCard, periodLong, periodShort, periodWeeks, roundRow, roundsWindow, rulesOf } from "./format";
import type { RoomDetail, RoundSummary } from "./types";

const TODAY = "2026-10-12";

/** 주 단위 회차 n개 — label "1주차"… */
const weekly = (n: number, start: string, titles: string[] = []): RoundSummary[] =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    label: `${i + 1}주차`,
    title: titles[i] ?? `R${i + 1}`,
    startDate: addDays(start, i * 7),
    endDate: addDays(start, i * 7 + 6),
    leafCount: 2,
    assigned: 0,
    submitted: 0,
    pct: null,
  }));

describe("periodCard (main §3-5, D14 round(days/7)주)", () => {
  it("same year: toeic 56일 → 8주", () => expect(periodCard("2026-11-02", "2026-12-27")).toBe("2026.11.02 – 12.27 · 8주"));
  it("cross year keeps both years (Review Focus 1): spring 119일 → 17주", () =>
    expect(periodCard("2026-10-05", "2027-01-31")).toBe("2026.10.05 – 2027.01.31 · 17주"));
  it("aws 92일 → 13주 (목업 '3개월' 폐기)", () => expect(periodCard("2026-10-01", "2026-12-31")).toBe("2026.10.01 – 12.31 · 13주"));
  it("algo 07.01 pads the month", () => expect(periodCard("2026-07-01", "2026-09-30")).toBe("2026.07.01 – 09.30 · 13주"));
});

describe("periodLong", () => {
  it("aws", () => expect(periodLong("2026-10-01", "2026-12-31")).toBe("2026.10.01(목) – 12.31(목)"));
  it("spring cross-year", () => expect(periodLong("2026-10-05", "2027-01-31")).toBe("2026.10.05(월) – 2027.01.31(일)"));
});

describe("ddayOf (roomview §3.2)", () => {
  it("recruit → start, active → end, ended → mmdd", () => {
    expect(ddayOf("recruit", TODAY, "2026-11-02", "2026-12-27")).toEqual({ short: "D-21", long: "시작까지 D-21" });
    expect(ddayOf("active", TODAY, "2026-10-01", "2026-12-31")).toEqual({ short: "D-80", long: "종료까지 D-80" });
    expect(ddayOf("ended", TODAY, "2026-07-01", "2026-09-30")).toEqual({ short: "종료", long: "09.30 종료" });
    expect(ddayOf("draft", TODAY, "2026-11-09", "2026-12-20").short).toBe("D-28");
  });
});

describe("curIndexOf / roundsWindow (roomview §3.6)", () => {
  it("aws: 13 rounds from 10-01, today in 2주차 → rows 1·2·3, 이후 10개", () => {
    const r = weekly(13, "2026-10-01");
    expect(curIndexOf(r, TODAY)).toEqual({ index: 1, inside: true });
    const w = roundsWindow(r, "active", TODAY);
    expect(w.rows.map((x) => x.label)).toEqual(["1주차", "2주차", "3주차"]);
    expect(w.more).toBe("이후 10개 회차가 더 있어요");
  });
  it("react: 8 rounds from 09-21, today in 4주차 → 3·4·5 + prefix", () => {
    const w = roundsWindow(weekly(8, "2026-09-21"), "active", TODAY);
    expect(w.rows.map((x) => x.label)).toEqual(["3주차", "4주차", "5주차"]);
    expect(w.more).toBe("1~2주차 완료 · 이후 3개 회차가 더 있어요");
  });
  it("recruit shows first 3: toeic 8 → 이후 5개, sqld 4 → 이후 1개, jcg 2 → ''", () => {
    expect(roundsWindow(weekly(8, "2026-11-02"), "recruit", TODAY).more).toBe("이후 5개 회차가 더 있어요");
    expect(roundsWindow(weekly(4, "2026-10-26"), "recruit", TODAY).more).toBe("이후 1개 회차가 더 있어요");
    const jcg = roundsWindow(weekly(2, "2026-10-19"), "recruit", TODAY);
    expect(jcg.rows).toHaveLength(2);
    expect(jcg.more).toBe("");
  });
  it("ended shows all rounds", () => {
    const w = roundsWindow(weekly(13, "2026-07-01"), "ended", TODAY);
    expect(w.rows).toHaveLength(13);
    expect(w.more).toBe("");
  });
  it("gap between rounds (Review Focus 2): anchors on the last started round", () => {
    const gap: RoundSummary[] = [
      { ...weekly(1, "2026-10-01")[0], endDate: "2026-10-05" },
      { ...weekly(1, "2026-10-15")[0], id: "2", label: "2주차" },
      { ...weekly(1, "2026-10-22")[0], id: "3", label: "3주차" },
    ];
    expect(curIndexOf(gap, TODAY)).toEqual({ index: 0, inside: false });
    expect(roundsWindow(gap, "active", TODAY).rows.map((x) => x.label)).toEqual(["1주차", "2주차", "3주차"]);
    expect(curIndexOf(weekly(3, "2026-11-02"), TODAY)).toBeNull();
  });
});

describe("roundRow", () => {
  const r = weekly(1, "2026-10-01")[0];
  it("recruit → '과제 N개' without numbers", () => {
    expect(roundRow(r, "recruit", TODAY, false)).toEqual({ label: "1주차", title: "R1", dates: "10.01 – 10.07", state: "과제 2개" });
  });
  it("active states by date and pct", () => {
    expect(roundRow({ ...r, assigned: 8, submitted: 5, pct: 63 }, "active", TODAY, false).state).toBe("기간 종료");
    expect(roundRow({ ...r, assigned: 8, submitted: 8, pct: 100 }, "active", TODAY, false).state).toBe("완료");
    expect(roundRow({ ...r, startDate: "2026-10-08", endDate: "2026-10-14" }, "active", TODAY, true)).toMatchObject({ state: "진행중", current: true, dates: "10.08 – 10.14" });
    expect(roundRow({ ...r, startDate: "2026-10-15", endDate: "2026-10-21" }, "active", TODAY, false).state).toBe("예정");
  });
  it("ended → 완료 with numbers", () => {
    expect(roundRow({ ...r, assigned: 24, submitted: 23 }, "ended", TODAY, false)).toMatchObject({ state: "완료", sub: 23, total: 24 });
  });
});

const stats = (o: Partial<RoomDetail["stats"]>): RoomDetail["stats"] => ({
  roundCount: 8, leafCount: 16, commonCount: 16, designatedCount: 0, totalAssignments: 0, totalSubmissions: 0, overallPct: null, unassignedCount: 0, startWeekdays: [1], ...o,
});

describe("curOf (roomview §1.3 / mystudy §3.8)", () => {
  it("recruit toeic", () => {
    expect(curOf({ status: "recruit", startDate: "2026-11-02", endDate: "2026-12-27", currentRound: null, rounds: weekly(8, "2026-11-02"), stats: stats({}) }, TODAY)).toEqual({
      pill: "시작 전", title: "11월 2일(월) 첫 회차가 열려요", meta: "8회차 · 과제 16개 준비됨", tasks: [],
    });
  });
  it("active aws with current round and tasks", () => {
    const cur: RoundSummary = {
      ...weekly(13, "2026-10-01", ["IAM·VPC", "EC2·S3"])[1],
      assigned: 3, submitted: 1, pct: 33,
      tasks: [
        { id: "21", title: "EC2 인스턴스 유형 정리", type: "designated", startDate: "2026-10-08", endDate: "2026-10-14",
          people: [{ userId: "u-jieun", nickname: "지은", tone: "peach", status: "done" }, { userId: "u-1", nickname: "철수", tone: "blue", status: "open" }] },
        { id: "22", title: "S3 스토리지 클래스 발표자료", type: "designated", startDate: "2026-10-10", endDate: "2026-10-14",
          people: [{ userId: "u-hana", nickname: "하나", tone: "lav", status: "open" }] },
      ],
    };
    const v = curOf({ status: "active", startDate: "2026-10-01", endDate: "2026-12-31", currentRound: cur, rounds: weekly(13, "2026-10-01"), stats: stats({ roundCount: 13 }) }, TODAY);
    expect(v.pill).toBe("2주차 · 진행중");
    expect(v.title).toBe("EC2·S3");
    expect(v.meta).toBe("10.08(목) – 10.14(수) · 마감 D-2");
    expect(v.tasks[0]).toEqual({ title: "EC2 인스턴스 유형 정리", type: "지정", dates: "10.08 – 10.14",
      people: [{ userId: "u-jieun", name: "지은", tone: "peach", status: "done" }, { userId: "u-1", name: "철수", tone: "blue", status: "open" }] });
  });
  it("ended algo — 'N주 완주' is period weeks (13), not round count (seed has 3 depth-2 rounds) (D14, S10)", () => {
    expect(curOf({ status: "ended", startDate: "2026-07-01", endDate: "2026-09-30", currentRound: null, rounds: weekly(3, "2026-07-01"),
      stats: stats({ roundCount: 3, totalAssignments: 78, totalSubmissions: 68, overallPct: 87 }) }, TODAY)).toEqual({
      pill: "종료", title: "13주 완주 · 전체 달성률 87%", meta: "07.01 – 09.30 · 제출 68 / 78건", tasks: [],
    });
  });
  it("periodWeeks", () => {
    expect(periodWeeks("2026-07-01", "2026-09-30")).toBe(13);                // 92일
    expect(periodWeeks("2026-11-02", "2026-12-27")).toBe(8);
  });
  it("active without current round (Review Focus 2)", () => {
    const gap = [{ ...weekly(1, "2026-10-01")[0], endDate: "2026-10-05" }, { ...weekly(1, "2026-10-15")[0], id: "2", label: "2주차" }];
    expect(curOf({ status: "active", startDate: "2026-10-01", endDate: "2026-12-31", currentRound: null, rounds: gap, stats: stats({ roundCount: 2 }) }, TODAY)).toEqual({
      pill: "1주차 · 기간 종료", title: "진행 중인 회차가 없어요", meta: "다음 회차 10.15 시작", tasks: [],
    });
  });
});

describe("curOf final-batch rules", () => {
  it("ended room with no assignments (overallPct null) → '—', not 0%", () => {
    expect(curOf({ status: "ended", startDate: "2026-07-01", endDate: "2026-09-30", currentRound: null, rounds: weekly(3, "2026-07-01"),
      stats: stats({ roundCount: 3, overallPct: null }) }, TODAY).title).toBe("13주 완주 · 전체 달성률 —");
  });
  it("gap pill says 완료 when the previous round is fully submitted (matches roundRow)", () => {
    const gap = [{ ...weekly(1, "2026-10-01")[0], endDate: "2026-10-05", pct: 100 }, { ...weekly(1, "2026-10-15")[0], id: "2", label: "2주차" }];
    const dto = { status: "active" as const, startDate: "2026-10-01", endDate: "2026-12-31", currentRound: gap[0], rounds: gap, stats: stats({ roundCount: 2 }) };
    expect(curOf(dto, TODAY).pill).toBe("1주차 · 완료");
    expect(roundRow(gap[0], "active", TODAY, false).state).toBe("완료");
  });
});

describe("curOf server gap shape (preflight C2)", () => {
  it("currentRound = previous ended round (server fallback) → no current round", () => {
    const gap = [{ ...weekly(1, "2026-10-01")[0], endDate: "2026-10-05" }, { ...weekly(1, "2026-10-15")[0], id: "2", label: "2주차" }];
    expect(curOf({ status: "active", startDate: "2026-10-01", endDate: "2026-12-31", currentRound: gap[0], rounds: gap, stats: stats({ roundCount: 2 }) }, TODAY)).toEqual({
      pill: "1주차 · 기간 종료", title: "진행 중인 회차가 없어요", meta: "다음 회차 10.15 시작", tasks: [],
    });
  });
});

describe("endPart", () => {
  it("same year → MM.DD, cross year → YYYY.MM.DD", () => {
    expect(endPart("2026-11-02", "2026-12-27")).toBe("12.27");
    expect(endPart("2026-10-05", "2027-01-31")).toBe("2027.01.31");
  });
});

describe("periodShort (preflight E5a)", () => {
  it("same year / cross year", () => {
    expect(periodShort("2026-11-02", "2026-12-27")).toBe("2026.11.02 – 12.27");
    expect(periodShort("2026-10-05", "2027-01-31")).toBe("2026.10.05 – 2027.01.31");
  });
});

describe("glanceOf (roomview §3.7)", () => {
  it("Sunday start isodow 7 (preflight C3)", () => {
    expect(glanceOf(stats({ startWeekdays: [7] }), "recruit").rounds).toBe("8회차 · 매주 일요일 시작");
    expect(glanceOf(stats({ roundCount: 12, startWeekdays: [4, 7] }), "recruit").rounds).toBe("12회차 · 목·일 시작");
  });
  it("toeic / cs / jcg / algo / aws", () => {
    expect(glanceOf(stats({}), "recruit")).toEqual({ rounds: "8회차 · 매주 월요일 시작", tasks: "16개 · 모두 공통 과제" });
    expect(glanceOf(stats({ roundCount: 12, leafCount: 24, commonCount: 24, startWeekdays: [1, 4] }), "recruit").rounds).toBe("12회차 · 월·목 시작");
    expect(glanceOf(stats({ roundCount: 2, leafCount: 6, commonCount: 6 }), "recruit")).toEqual({ rounds: "2회차", tasks: "6개 · 모두 공통 과제" });
    expect(glanceOf(stats({ roundCount: 4, leafCount: 9, commonCount: 7, designatedCount: 2 }), "recruit").tasks).toBe("9개 · 공통 7 · 지정 2");
    expect(glanceOf(stats({ roundCount: 3, leafCount: 13, totalAssignments: 78, totalSubmissions: 68, startWeekdays: [3] }), "ended")).toEqual({ rounds: "3회차 · 완료", tasks: "78건 중 68건 제출" });   // algo 시드 = depth-2 3개(D14)
    expect(glanceOf(stats({ roundCount: 13, leafCount: 8, commonCount: 5, designatedCount: 3, startWeekdays: [4] }), "active")).toEqual({ rounds: "13회차 · 매주 목요일 시작", tasks: "8개 · 공통 5 · 지정 3" });
  });
});

describe("rulesOf", () => {
  it("splits markdown bullets", () => {
    expect(rulesOf("- 첫째\n* 둘째\n\n셋째\n")).toEqual(["첫째", "둘째", "셋째"]);
    expect(rulesOf("")).toEqual([]);
  });
});
