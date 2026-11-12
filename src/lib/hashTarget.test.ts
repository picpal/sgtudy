import { describe, expect, it } from "vitest";
import { hashOf } from "./hashTarget";

describe("hashOf", () => {
  it("퍼센트 인코딩은 풀고, 깨진 해시(#%E0)는 던지지 않고 원문 그대로", () => {
    expect(hashOf("/x#comment-%31")).toBe("comment-1");
    expect(() => hashOf("/x#%E0")).not.toThrow();
    expect(hashOf("/x#%E0")).toBe("%E0");
  });
});
