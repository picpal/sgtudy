import { describe, expect, it } from "vitest";
import { originAllowed, parseAuthorization } from "./auth";

const PAT = "sgt_pat_" + "a".repeat(64);
describe("parseAuthorization", () => {
  it("Bearer PAT", () => expect(parseAuthorization(`Bearer ${PAT}`)).toEqual({ kind: "pat", token: PAT }));
  it("대소문자 무시 · 앞뒤 공백", () => expect(parseAuthorization(`  bearer ${PAT} `)).toEqual({ kind: "pat", token: PAT }));
  it("PAT 접두인데 형식 틀림 → null", () => expect(parseAuthorization("Bearer sgt_pat_xyz")).toBeNull());
  it("PAT 대문자 hex → null(서버는 소문자만 발급)", () => expect(parseAuthorization("Bearer sgt_pat_" + "A".repeat(64))).toBeNull());
  it("그 밖의 Bearer 는 jwt(2단계 OAuth)", () => expect(parseAuthorization("Bearer eyJhbGc.x.y")).toEqual({ kind: "jwt", jwt: "eyJhbGc.x.y" }));
  it("없음·Basic·토큰 둘 → null", () => {
    expect(parseAuthorization(null)).toBeNull();
    expect(parseAuthorization("Basic abc")).toBeNull();
    expect(parseAuthorization(`Bearer ${PAT} ${PAT}`)).toBeNull();
  });
});
describe("originAllowed", () => {
  it("Origin 없음(CLI·서버) 허용", () => expect(originAllowed(null, ["https://sgtudy.app"])).toBe(true));
  it("목록 안 허용 · 밖 거부", () => {
    expect(originAllowed("https://sgtudy.app", ["https://sgtudy.app"])).toBe(true);
    expect(originAllowed("https://evil.example", ["https://sgtudy.app"])).toBe(false);
  });
});
