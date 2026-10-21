/* /api/mcp 의 HTTP 경계 〔C#6·#11〕 — 본문 상한 읽기 · 거부 응답(토큰·Authorization 을 싣지 않는다) */
export const MAX_BODY_BYTES = 512 * 1024;

type ReadResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413; code: "PARSE_ERROR" | "PAYLOAD_TOO_LARGE" };

/** Content-Length 가 max 초과면 본문을 읽지 않고 413(라우트도 DB 왕복 전에 같은 선검사를 한다 — 둘 다 의도, 지우지 말 것). 아니면 스트림을 읽다가 누적이 max 를 넘는 순간 cancel 후 413
    (Content-Length 누락·거짓 대비). JSON 이 아니면 400. clone·무제한 req.json() 없음 */
export async function readJsonCapped(req: Request, max = MAX_BODY_BYTES): Promise<ReadResult> {
  const tooLarge = { ok: false, status: 413, code: "PAYLOAD_TOO_LARGE" } as const;
  if (Number(req.headers.get("content-length") ?? 0) > max) return tooLarge;
  const chunks: Uint8Array[] = [];
  if (req.body) {
    const reader = req.body.getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => {});
        return tooLarge;
      }
      chunks.push(value);
    }
  }
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) };
  } catch {
    return { ok: false, status: 400, code: "PARSE_ERROR" };
  }
}

/** JSON {error: code}. 401 → WWW-Authenticate(형식·폐기·만료 = invalid_token, 자격 없음(AUTH_REQUIRED) = error 생략 — RFC 6750 §3.1), 429 → Retry-After */
/** 〔리뷰 I1〕 JSON-RPC 배치(배열 본문) 거부 — 1 POST = 최대 100 메시지가 HTTP 요청 단위 계량(N7)을 우회한다. MCP 2025-06-18 부터 배치 없음 */
export function rejectBatch(): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch requests are not supported" } }),
    { status: 400, headers: { "content-type": "application/json" } });
}

export function deny(status: number, code: string, retryAfterSec?: number): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (status === 401) headers["www-authenticate"] = code === "AUTH_REQUIRED" ? 'Bearer realm="sgtudy"' : 'Bearer realm="sgtudy", error="invalid_token"';
  if (status === 429 && retryAfterSec !== undefined) headers["retry-after"] = String(retryAfterSec);
  return new Response(JSON.stringify({ error: code }), { status, headers });
}
