import { describe, expect, it } from "vitest";
import { addDays } from "../normalize";
import { labelFor, splitRounds } from "./schedule";

/* 회차 표(D23) — 7/14일 전환 · 꼬리 합침 · 마지막 = 종료일 · 연속 */
const S = "2026-10-26";
const days = (n: number) => splitRounds(S, addDays(S, n - 1));

function expectContiguous(r: ReturnType<typeof splitRounds>, end: string) {
  expect(r.rounds[0].startDate).toBe(S);
  expect(r.rounds.at(-1)!.endDate).toBe(end);
  for (let i = 1; i < r.rounds.length; i++) expect(r.rounds[i].startDate).toBe(addDays(r.rounds[i - 1].endDate, 1));
  r.rounds.forEach((x, i) => expect(x.index).toBe(i));
}

describe("splitRounds", () => {
  it("12주(84일) → 7일 회차 12개 · 라벨 N주차 · 연속", () => {
    const r = days(84);
    expect([r.cadenceDays, r.rounds.length]).toEqual([7, 12]);
    expect(r.rounds[0]).toEqual({ index: 0, label: "1주차", startDate: "2026-10-26", endDate: "2026-11-01" });
    expect(r.rounds[11].label).toBe("12주차");
    expectContiguous(r, addDays(S, 83));
  });
  it("꼬리 3일 이상은 회차 하나 · 3일 미만은 앞 회차에 합친다", () => {
    expect(days(17).rounds.length).toBe(3); // 7+7+3
    expect(days(17).rounds[2]).toMatchObject({ startDate: addDays(S, 14), endDate: addDays(S, 16) });
    const r = days(16); // 7+9
    expect(r.rounds.length).toBe(2);
    expect(r.rounds[1]).toMatchObject({ startDate: addDays(S, 7), endDate: addDays(S, 15) });
  });
  it("짧은 방(1일·6일)도 회차 1개 · 끝 = 종료일", () => {
    expect(splitRounds(S, S).rounds).toEqual([{ index: 0, label: "1주차", startDate: S, endDate: S }]);
    expect(days(6).rounds).toEqual([{ index: 0, label: "1주차", startDate: S, endDate: addDays(S, 5) }]);
    expect(days(9).rounds.length).toBe(1); // 7 + 꼬리 2 → 합침
  });
  it("182일 = 26주차 · 꼬리 1~2일(183·184일)은 26주차에 합쳐 7일 주기 유지", () => {
    for (const n of [182, 183, 184]) {
      const r = days(n);
      expect([n, r.cadenceDays, r.rounds.length]).toEqual([n, 7, 26]);
      expectContiguous(r, addDays(S, n - 1));
    }
  });
  it("185일(7일 회차 27개) → 14일 회차 · 라벨 N회차", () => {
    const r = days(185); // 13×14 + 3
    expect([r.cadenceDays, r.rounds.length]).toEqual([14, 14]);
    expect(r.rounds[0]).toEqual({ index: 0, label: "1회차", startDate: S, endDate: addDays(S, 13) });
    expectContiguous(r, addDays(S, 184));
  });
  it("1년(366일) → 14일 회차 26개 이하 · 끝 = 종료일", () => {
    const end = "2027-10-26";
    const r = splitRounds(S, end);
    expect(r.cadenceDays).toBe(14);
    expect(r.rounds.length).toBeLessThanOrEqual(26);
    expectContiguous(r, end);
  });
  it("월말·윤년을 넘어도 날짜가 맞다", () => {
    const r = splitRounds("2028-02-22", "2028-03-06"); // 2028 윤년
    expect(r.rounds.map((x) => [x.startDate, x.endDate])).toEqual([["2028-02-22", "2028-02-28"], ["2028-02-29", "2028-03-06"]]);
  });
  it("labelFor", () => {
    expect([labelFor(0, 7), labelFor(11, 14)]).toEqual(["1주차", "12회차"]);
  });
});
