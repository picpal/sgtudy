import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { originAllowed, parseAuthorization } from "@/lib/mcp/auth";
import { deny, MAX_BODY_BYTES, readJsonCapped, rejectBatch } from "@/lib/mcp/http";
import { authenticatePat, patInvoker } from "@/lib/mcp/invoke";
import { buildServer } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const allowed = () => (process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// 〔C#6〕 순서: Origin → 헤더 형식 → 크기 선검사 → PAT 검증(HTTP 요청마다 1회, transport 앞) → 본문(상한) → transport.
// initialize·tools/list·tools/call 모두 같은 길. JSON-RPC 배치(배열)는 transport 전에 400(〔리뷰 I1〕 계량 우회 차단). 도구 콜백은 이미 인증된 invoker 만 받는다(던지지 않음).
// 연결 중 폐기·만료 → 다음 HTTP 요청이 여기서 401. 분당 한도(〔N7〕 HTTP 요청 120/분 포함) 초과 → 429 + Retry-After.
export async function POST(req: Request) {
  if (!originAllowed(req.headers.get("origin"), allowed())) return deny(403, "ORIGIN_NOT_ALLOWED");
  const header = req.headers.get("authorization");
  if (!header) return deny(401, "AUTH_REQUIRED");
  const cred = parseAuthorization(header);
  if (!cred || cred.kind !== "pat") return deny(401, "API_TOKEN_INVALID");          // 2단계: jwt → OAuth 경로
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return deny(413, "PAYLOAD_TOO_LARGE");   // 〔C#11〕 DB 왕복 전
  const auth = await authenticatePat(cred.token);
  if (!auth.ok) return deny(auth.status, auth.code, auth.retryAfterSec);
  const body = await readJsonCapped(req, MAX_BODY_BYTES);                            // 〔C#11〕 clone·무제한 파싱 없음
  if (!body.ok) return deny(body.status, body.code);
  if (Array.isArray(body.value)) return rejectBatch();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_BODY_BYTES });
  const who = { ...auth.who, source: "pat" as const };
  await buildServer(patInvoker(cred.token), { origin: new URL(req.url).origin, who }).connect(transport);
  return transport.handleRequest(req, { parsedBody: body.value });
}

const notAllowed = () => new Response(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;      // stateless — 서버 → 클라이언트 SSE 스트림 없음
export const DELETE = notAllowed;
