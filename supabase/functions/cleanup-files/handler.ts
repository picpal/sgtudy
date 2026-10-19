import { runAll, type Store } from "./cleanup.ts";
import { isAuthorized, parseLimit, responseStatus } from "./logic.ts";

/** 호출 보호: 전용 시크릿 헤더. 값은 env(CLEANUP_FILES_SECRET)·Vault 에만 있다 */
export const SECRET_HEADER = "x-cleanup-secret";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createHandler(deps: { secret: string | undefined; store: () => Store }) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json(405, { error: "method not allowed" });
    if (!isAuthorized(deps.secret, req.headers.get(SECRET_HEADER))) return json(401, { error: "unauthorized" });
    let limit: unknown;
    try {
      const text = await req.text();
      limit = text.trim() ? (JSON.parse(text) as { limit?: unknown })?.limit : undefined;
    } catch {
      return json(400, { error: "invalid json body" });
    }
    try {
      const summary = await runAll(deps.store(), { limit: parseLimit(limit) });
      const status = responseStatus(summary);
      (status === 200 ? console.log : console.error)("cleanup-files", status, JSON.stringify(summary));
      return json(status, summary);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("cleanup-files failed", message);
      return json(500, { error: message });
    }
  };
}
