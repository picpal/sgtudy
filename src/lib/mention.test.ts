import { describe, expect, it } from "vitest";
import {
  activeQuery, displayLength, insertMention, isImeComposing, matchMembers, mentionIds, mentionLabel, mentionToken, searchKey, tokenize, toEditable, toTokens,
} from "./mention";

const A = "11111111-2222-3333-4444-555555555555";
const B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const C = "99999999-8888-7777-6666-555555555555";

describe("tokenize · mentionIds · displayLength (server comment_parse 와 같은 규칙)", () => {
  it("splits text and tokens · no empty text segments", () => {
    expect(tokenize(`<@${A}> 안녕 <@${B}>`)).toEqual([
      { type: "mention", userId: A }, { type: "text", text: " 안녕 " }, { type: "mention", userId: B },
    ]);
    expect(tokenize("평문")).toEqual([{ type: "text", text: "평문" }]);
    expect(tokenize("")).toEqual([]);
  });
  it("uppercase / malformed tokens stay text", () => {
    expect(tokenize(`<@${B.toUpperCase()}> <@nope>`)).toEqual([{ type: "text", text: `<@${B.toUpperCase()}> <@nope>` }]);
  });
  it("mentionIds: unique, first-seen order", () => {
    expect(mentionIds(`<@${B}> <@${A}> <@${B}>`)).toEqual([B, A]);
  });
  it("displayLength: token = 1 char, code points (emoji = 1)", () => {
    expect(displayLength(`가<@${A}>나`)).toBe(3);
    expect(displayLength("👍🏻")).toBe(2);
    expect(displayLength("abc")).toBe(3);
  });
  it("mentionToken lowercases", () => {
    expect(mentionToken(B.toUpperCase())).toBe(`<@${B}>`);
  });
});

describe("toTokens · toEditable", () => {
  const picks = [{ userId: A, nickname: "철수" }, { userId: B, nickname: "철수 킴" }];
  it("longest nickname first (spaces in nicknames)", () => {
    expect(toTokens("@철수 킴 안녕 @철수 하이", picks)).toBe(`<@${B}> 안녕 <@${A}> 하이`);
  });
  it("only at start / after whitespace or bracket; email-like a@철수 ignored", () => {
    expect(toTokens("@철수\n(@철수) a@철수", picks)).toBe(`<@${A}>\n(<@${A}>) a@철수`);
  });
  it("punctuation after is fine · letters after = broken mention → plain", () => {
    expect(toTokens("@철수. @철수, @철수님 @철", picks)).toBe(`<@${A}>. <@${A}>, @철수님 @철`);
  });
  it("unpicked nickname stays plain · existing tokens untouched · empty picks", () => {
    expect(toTokens(`@하나 <@${C}>`, picks)).toBe(`@하나 <@${C}>`);
    expect(toTokens("@철수", [])).toBe("@철수");
  });
  it("toEditable restores text + picks; unknown uid keeps raw token (re-save keeps it)", () => {
    const body = `<@${A}> 그리고 <@${B}> <@${A}> <@${C}>`;
    const people = { [A]: { nickname: "철수" }, [B]: { nickname: "철수 킴" } };
    const e = toEditable(body, people);
    expect(e.text).toBe(`@철수 그리고 @철수 킴 @철수 <@${C}>`);
    expect(e.picks).toEqual([{ userId: A, nickname: "철수" }, { userId: B, nickname: "철수 킴" }]);
    expect(toTokens(e.text, e.picks)).toBe(body);   // 왕복
  });
  it("mentionLabel: unknown → @알 수 없음", () => {
    expect(mentionLabel(A, { [A]: { nickname: "철수" } })).toBe("@철수");
    expect(mentionLabel(C, {})).toBe("@알 수 없음");
  });
});

describe("activeQuery · insertMention", () => {
  it("line start / after whitespace; caret position decides", () => {
    expect(activeQuery("@철", 2)).toEqual({ start: 0, query: "철" });
    expect(activeQuery("안녕 @", 4)).toEqual({ start: 3, query: "" });
    expect(activeQuery("줄\n@하", 4)).toEqual({ start: 2, query: "하" });
    expect(activeQuery("@철수 안녕", 6)).toBeNull();          // 질의에 공백 → 닫힘
    expect(activeQuery("@철수 안녕", 3)).toEqual({ start: 0, query: "철수" });
  });
  it("email a@b ignored · no @ · too long · double @", () => {
    expect(activeQuery("mail a@b", 8)).toBeNull();
    expect(activeQuery("안녕", 2)).toBeNull();
    expect(activeQuery("@" + "가".repeat(17), 18)).toBeNull();
    expect(activeQuery("@@", 2)).toBeNull();
  });
  it("Korean IME intermediate (jamo) is a query", () => {
    expect(activeQuery("@ㅎ", 2)).toEqual({ start: 0, query: "ㅎ" });
  });
  it("insertMention replaces the query with '@nick ' and moves caret", () => {
    expect(insertMention("hi @철 bye", { start: 3, query: "철" }, "철수 킴")).toEqual({ text: "hi @철수 킴 bye", caret: 9 });
    expect(insertMention("@", { start: 0, query: "" }, "하나")).toEqual({ text: "@하나 ", caret: 4 });
  });
});

describe("matchMembers · searchKey (Korean IME)", () => {
  const ms = [
    { userId: "me", nickname: "하나" }, { userId: "1", nickname: "철수" }, { userId: "2", nickname: "Hana Kim" },
    { userId: "3", nickname: "김하나" }, { userId: "4", nickname: "한결" }, { userId: "5", nickname: "닭강정" },
  ];
  it("jamo keys: composing '한' is a prefix of '하나'", () => {
    expect(searchKey("한")).toBe("ㅎㅏㄴ");
    expect(searchKey("하나").startsWith(searchKey("한"))).toBe(true);
    expect(searchKey("닭").startsWith(searchKey("달"))).toBe(true);
    expect(searchKey("ＡB")).toBe("ａb");
  });
  it("prefix before contains · self excluded · limit", () => {
    // "하" 는 "한결" 의 접두이기도 하다(조합 중 "한" 이 될 수 있다)
    expect(matchMembers("하", ms, "me").map((m) => m.nickname)).toEqual(["한결", "김하나"]);   // 본인(하나)은 후보에 없다
    expect(matchMembers("하나", ms, null).map((m) => m.nickname)).toEqual(["하나", "김하나"]);
    expect(matchMembers("ㅎ", ms, null).map((m) => m.nickname)).toEqual(["하나", "한결", "김하나"]);
    expect(matchMembers("한", ms, null).map((m) => m.nickname)).toEqual(["하나", "한결", "김하나"]);
    expect(matchMembers("hana", ms, null).map((m) => m.nickname)).toEqual(["Hana Kim"]);
    expect(matchMembers("닭", ms, null).map((m) => m.nickname)).toEqual(["닭강정"]);
    expect(matchMembers("", ms, "me", 3).map((m) => m.nickname)).toEqual(["철수", "Hana Kim", "김하나"]);
    expect(matchMembers("하나", ms, "me").map((m) => m.nickname)).toEqual(["김하나"]);
    expect(matchMembers("zz", ms, null)).toEqual([]);
  });
});

describe("isImeComposing", () => {
  it("isComposing · keyCode 229 · nativeEvent variants", () => {
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
    expect(isImeComposing({ nativeEvent: { keyCode: 229 } })).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
