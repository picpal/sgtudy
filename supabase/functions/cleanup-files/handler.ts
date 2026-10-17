import { runCleanup, type Store } from "./cleanup.ts";
import { isAuthorized, parseLimit } from "./logic.ts";

/** 호출 보호: 전용 시크릿 헤더. 값은 env(CLEANUP_FILES_SECRET)·Vault 에만 있다 */
export const SECRET_HEADER = "x-cleanup-secret";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function createHandler(deps: { secret: string | undefined; store: () => Store; now?: () => Date }) {
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
      const summary = await runCleanup(deps.store(), { now: (deps.now ?? (() => new Date()))(), limit: parseLimit(limit) });
      console.log("cleanup-files", JSON.stringify(summary));
      return json(200, summary);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("cleanup-files failed", message);
      return json(500, { error: message });
    }
  };
}
