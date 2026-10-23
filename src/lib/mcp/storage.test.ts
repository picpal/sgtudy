import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* MCP 경로(src/lib/mcp/**, src/app/api/mcp/**)에 관리자 키가 들어오지 않는다 (md-images 스펙 D21 · 계획 Global Constraints).
   그림 올리기의 서명·읽기도 anon 키 + 0045 티켓 정책만으로 한다 */
const ROOTS = ["src/lib/mcp", "src/app/api/mcp"];
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

describe("MCP 경로에 service_role 없음", () => {
  it("소스에 service_role·createAdminClient·SUPABASE_SERVICE_ROLE_KEY 0건", () => {
    const all = ROOTS.flatMap(files);
    expect(all).toContain(join("src/lib/mcp", "storage.ts"));
    const hits = all.filter((f) => /service_role|createAdminClient|SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
    expect(hits).toEqual([]);
  });
  it("storage.ts 는 anon 키만 읽는다", () => {
    const src = readFileSync("src/lib/mcp/storage.ts", "utf8");
    expect(src).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(src).not.toMatch(/admin/i);
  });
});
