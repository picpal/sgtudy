import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../../../package.json";
import { toolErrorText } from "./errors";
import type { Invoke } from "./invoke";
import { PROMPTS } from "./prompts";
import { SERVER_INSTRUCTIONS, TOOLS, type Ctx, type ToolResult } from "./tools";

/** 요청마다 새로 만든다(stateless). invoke 는 라우트가 이미 인증한 토큰의 invoker */
export function buildServer(invoke: Invoke, ctx: Ctx): McpServer {
  const server = new McpServer({ name: "sgtudy", version: pkg.version }, { instructions: SERVER_INSTRUCTIONS });
  for (const t of TOOLS) {
    server.registerTool(t.name, { title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations },
      async (args): Promise<ToolResult> => {
        try {
          return await t.run(invoke, args as Record<string, unknown>, ctx);
        } catch {
          // 포맷터가 예상 밖 응답에 걸려도 SDK 의 영어 예외 문구 대신 한국어 오류 + 다음 행동
          return { content: [{ type: "text", text: toolErrorText({ code: "INTERNAL", message: "처리 중 오류가 났어요" }) }], isError: true };
        }
      });
  }
  for (const p of PROMPTS) {
    server.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema: p.args },
      (a) => ({ messages: [{ role: "user", content: { type: "text", text: p.render(a as Record<string, string>) } }] }));
  }
  return server;
}
