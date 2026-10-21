export type Credential = { kind: "pat"; token: string } | { kind: "jwt"; jwt: string };
const PAT_RE = /^sgt_pat_[0-9a-f]{64}$/;

/** Authorization 헤더 → 자격. PAT 접두인데 형식이 틀리면 null(=401). 그 밖의 Bearer 는 2단계 OAuth access token */
export function parseAuthorization(header: string | null): Credential | null {
  const m = header ? /^bearer\s+(\S+)$/i.exec(header.trim()) : null;
  if (!m) return null;
  const t = m[1];
  if (t.startsWith("sgt_pat_")) return PAT_RE.test(t) ? { kind: "pat", token: t } : null;
  return { kind: "jwt", jwt: t };
}

/** MCP 스펙 DNS rebinding 권고 — 브라우저 Origin 은 허용 목록만. CLI·서버 호출은 Origin 이 없다 */
export const originAllowed = (origin: string | null, allowed: string[]) => origin === null || allowed.includes(origin);
