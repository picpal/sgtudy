import { describe, expect, it } from "vitest";
import type { Db } from "./errors";
import { createToken, expiresText, lastUsedText, listTokens, MCP_ALLOW_SNIPPET, mcpAddCommand, mcpUrl, revokeToken, SCOPE_LABEL } from "./tokens";

const fake = () => {
  const calls: [string, Record<string, unknown>][] = [];
  const client = { rpc: (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return Promise.resolve({ data: {}, error: null }); } } as unknown as Db;
  return { calls, client };
};

describe("tokens", () => {
  it("claude mcp add 명령", () =>
    expect(mcpAddCommand("https://sgtudy.app", "sgt_pat_x")).toBe(
      'claude mcp add --scope user --transport http sgtudy https://sgtudy.app/api/mcp --header "Authorization: Bearer sgt_pat_x"'));
  it("허용 목록 조각: 읽기 3 + 미리보기만(적용·삭제는 묻기)", () => {
    const allow = JSON.parse(MCP_ALLOW_SNIPPET).permissions.allow as string[];
    expect(allow).toEqual(["mcp__sgtudy__list_my_studies", "mcp__sgtudy__get_curriculum", "mcp__sgtudy__list_my_tasks", "mcp__sgtudy__preview_curriculum_plan"]);
  });
  it("스코프 라벨", () => expect(SCOPE_LABEL).toEqual({ read: "읽기", "curriculum:write": "진행목표 편집", "personal:write": "개인 목표 추가" }));
  it("mcpUrl: 끝 슬래시를 떼고 /api/mcp", () => {
    expect(mcpUrl("http://localhost:3700/")).toBe("http://localhost:3700/api/mcp");
  });

  it("RPC 인자를 0033 계약대로 — 이름은 다듬는다", async () => {
    const { calls, client } = fake();
    await listTokens(client);
    await createToken("  노트북 ", ["read", "personal:write"], 90, client);
    await revokeToken("t1", client);
    expect(calls).toEqual([
      ["pat_list", {}],
      ["pat_create", { p_name: "노트북", p_scopes: ["read", "personal:write"], p_days: 90 }],
      ["pat_revoke", { p_id: "t1" }],
    ]);
  });

  it("마지막 사용·만료 표기: KST 날짜, 다른 해면 연도", () => {
    expect(lastUsedText({ lastUsedAt: null }, "2026-10-21")).toBe("사용 전");
    expect(lastUsedText({ lastUsedAt: "2026-10-20T15:30:00.000Z" }, "2026-10-21")).toBe("10.21 사용");
    expect(expiresText({ expiresAt: "2027-01-19T03:00:00.000Z" }, "2026-10-21")).toBe("2027.01.19 만료");
  });
});
