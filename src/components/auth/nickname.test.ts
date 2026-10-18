import { describe, expect, it } from "vitest";
import { nicknameCandidates, nicknameHint, pickAvailable } from "./nickname";
import { nicknameProblem } from "@/lib/api/me";
import type { NicknameCheck } from "@/lib/api/types";

describe("nicknameHint", () => {
  it("empty → idle rule text", () => {
    expect(nicknameHint("", null, false)).toEqual({ tone: "idle", text: "2~16자 · 한글·영문·숫자·_·. · 단어 사이 공백 한 칸" });
  });
  it("client rule violation wins before any server result", () => {
    expect(nicknameHint("a", null, false)).toEqual({ tone: "bad", text: "2~16자로 입력해 주세요" });
    expect(nicknameHint("chul-soo", { available: true }, false)).toEqual({ tone: "bad", text: "한글·영문·숫자·_·. 와 단어 사이 공백 한 칸만 쓸 수 있어요" });
  });
  it("rule copy mentions the single inner space it allows (Q2-17)", () => {
    expect(nicknameHint("a b", { available: true }, false)).toEqual({ tone: "ok", text: "사용할 수 있어요" });
    expect(nicknameHint("", null, false).text).toContain("공백 한 칸");
  });
  it("unchanged nickname on /me is fine without a check", () => {
    expect(nicknameHint("철수", null, false, "철수")).toEqual({ tone: "ok", text: "지금 쓰는 닉네임이에요" });
  });
  it("checking / server results", () => {
    expect(nicknameHint("영희", null, true)).toEqual({ tone: "checking", text: "확인 중…" });
    expect(nicknameHint("영희", { available: true }, false)).toEqual({ tone: "ok", text: "사용할 수 있어요" });
    expect(nicknameHint("철수", { available: false, reason: "taken" }, false)).toEqual({ tone: "bad", text: "이미 사용 중인 닉네임이에요" });
    expect(nicknameHint("관리자", { available: false, reason: "reserved" }, false)).toEqual({ tone: "bad", text: "사용할 수 없는 닉네임이에요" });
    expect(nicknameHint("영희", { available: false, reason: "invalid" }, false)).toEqual({ tone: "bad", text: "2~16자 · 한글·영문·숫자·_·. · 단어 사이 공백 한 칸" });
  });
  it("16자를 넘으면 글자 수와 함께 알린다 — 말없이 잘리지 않는다 (Q3-13)", () => {
    expect(nicknameHint("가".repeat(17), null, false)).toEqual({ tone: "bad", text: "16자까지 쓸 수 있어요 (지금 17자)" });
    expect(nicknameHint("가".repeat(16), { available: true }, false).tone).toBe("ok");
  });
  it("너무 짧을 때는 기존 안내", () => {
    expect(nicknameHint("가", null, false)).toEqual({ tone: "bad", text: "2~16자로 입력해 주세요" });
  });
});

describe("nicknameCandidates / pickAvailable — 닉네임 중복 시 대안 (시나리오 QA D4·#22)", () => {
  const seq = (...xs: number[]) => {
    let i = 0;
    return () => xs[i++ % xs.length];
  };
  it("규칙에 맞는 서로 다른 후보 — 숫자·_·. 붙이기", () => {
    const c = nicknameCandidates("은지쌤", seq(0.27, 0.07, 0.5, 0.91));
    expect(c.length).toBeGreaterThanOrEqual(3);
    expect(new Set(c).size).toBe(c.length);
    for (const x of c) {
      expect(x.startsWith("은지쌤")).toBe(true);
      expect(nicknameProblem(x)).toBeNull();
    }
  });
  it("16자를 넘지 않게 앞부분을 줄인다", () => {
    for (const x of nicknameCandidates("가나다라마바사아자차카타파하가나", seq(0.5))) expect([...x].length).toBeLessThanOrEqual(16);
  });
  it("끝 공백·마침표 없이 잘라 규칙을 지킨다", () => {
    for (const x of nicknameCandidates("study buddy club", seq(0.3))) expect(nicknameProblem(x)).toBeNull();
  });
  it("규칙에 안 맞는 입력이면 후보 없음", () => {
    expect(nicknameCandidates("a", seq(0.1))).toEqual([]);
    expect(nicknameCandidates("ㅋㅋ", seq(0.1))).toEqual([]);
  });
  it("쓸 수 있는 것만 최대 3개, 확인이 실패한 후보는 뺀다", async () => {
    const free = new Set(["a2", "a_3", "a.4", "a5"]);
    const check = async (v: string) => {
      if (v === "boom") throw new Error("x");
      return { available: free.has(v), reason: free.has(v) ? undefined : "taken" } as NicknameCheck;
    };
    expect(await pickAvailable(["a1", "boom", "a2", "a_3", "a.4", "a5"], check)).toEqual(["a2", "a_3", "a.4"]);
  });
});
