import { describe, expect, it } from "vitest";
import { nicknameHint } from "./nickname";

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
