import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/* 키·관리자 권한 경계(스펙 §6·Review Focus 4) — 정적 검사 */
const root = path.resolve(__dirname, "../../..");
function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|mts)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const src = (rel: string) => files(path.join(root, rel)).map((p) => [path.relative(root, p), readFileSync(p, "utf8")] as const);

describe("AI 인터뷰 — 키·SDK·관리자 클라이언트 경계", () => {
  it("클라이언트 코드(src/components·src/app/rooms)에 ANTHROPIC·@anthropic-ai/sdk 없음", () => {
    for (const [f, s] of [...src("src/components"), ...src("src/app/rooms")]) {
      expect(s.includes("ANTHROPIC"), f).toBe(false);
      expect(s.includes("@anthropic-ai/sdk"), f).toBe(false);
    }
  });
  it("src/lib/ai·src/app/api/rooms 는 createAdminClient·service_role 을 쓰지 않는다", () => {
    for (const [f, s] of [...src("src/lib/ai"), ...src("src/app/api/rooms")]) {
      expect(/createAdminClient|service_role|SERVICE_ROLE/.test(s), f).toBe(false);
    }
  });
  it("SDK 를 실제로 부르는 파일은 server-only", () => {
    for (const [f, s] of src("src/lib/ai")) if (/from "@anthropic-ai\/sdk"/.test(s)) expect(s.startsWith('import "server-only"'), f).toBe(true);
  });
});
