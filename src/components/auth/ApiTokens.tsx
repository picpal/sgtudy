"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Listbox } from "@/components/ui/Listbox";
import { toApiError } from "@/lib/api/errors";
import {
  createToken,
  expiresText,
  lastUsedText,
  listTokens,
  MCP_ALLOW_SNIPPET,
  mcpAddCommand,
  mcpUrl,
  revokeToken,
  SCOPE_LABEL,
  SCOPES,
  TOKEN_DAYS,
  type ApiScope,
  type ApiToken,
  type CreatedToken,
  type TokenDays,
} from "@/lib/api/tokens";
import { fieldClass, labelClass, primaryClass } from "./styles";

const noop = () => () => {};
/** 서버 렌더에서는 "" — 하이드레이션 뒤 브라우저 주소로 */
const useOrigin = () => useSyncExternalStore(noop, () => window.location.origin, () => "");

const BAD = "#B4462B";
const OK = "#0D7A64";
const codeClass = "m-0 block select-all whitespace-pre-wrap break-all rounded-[10px] bg-surface-3 px-3 py-[10px] font-mono text-[12px] leading-[1.6] text-ink";
const ghostBtn = "flex min-h-11 shrink-0 items-center justify-center rounded-[22px] border border-line-3 bg-surface px-4 text-[13px] font-semibold text-ink";

/** 복사 줄 — 위에 제목, 아래 코드(긴 토큰은 줄바꿈), 오른쪽 [복사]. 클립보드가 막히면 코드를 그대로 두고 직접 복사하라고 알린다 */
function CopyBlock({ label, text, copied, failed, onCopy }: { label: string; text: string; copied: boolean; failed: boolean; onCopy: () => void }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-ink-3">{label}</span>
        <button type="button" onClick={onCopy} aria-label={`${label} 복사`} className={ghostBtn}>
          {copied ? "복사했어요" : "복사"}
        </button>
      </div>
      <code className={codeClass}>{text}</code>
      {failed && <p role="alert" className="m-0 text-[12px]" style={{ color: BAD }}>복사하지 못했어요 · 직접 선택해 복사해 주세요</p>}
    </div>
  );
}

/**
 * /me 「AI 연결」 — 개인 액세스 토큰(PAT) 만들기·목록·폐기와 Claude Code 연결 안내(AI 연동 Task 9, 〔D21〕).
 * 원문은 만든 직후 이 컴포넌트 상태에만 있다(저장·로그 없음) — 화면을 떠나면 다시 볼 수 없다.
 */
export function ApiTokens() {
  const origin = useOrigin();
  const [today, setToday] = useState("");
  const [items, setItems] = useState<ApiToken[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [name, setName] = useState("Claude Code");
  const [scopes, setScopes] = useState<ApiScope[]>(SCOPES);
  const [days, setDays] = useState<TokenDays>(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState("");
  const [copyFailed, setCopyFailed] = useState("");
  const [target, setTarget] = useState<ApiToken | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let live = true;
    listTokens()
      .then((r) => live && (setToday(r.today), setItems(r.items)))
      .catch((e) => live && setLoadError(toApiError(e).message));
    return () => {
      live = false;
    };
  }, []);

  const toggleScope = (s: ApiScope) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : SCOPES.filter((x) => x === s || cur.includes(x))));

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setCopyFailed("");
    } catch {
      setCopied("");
      setCopyFailed(key);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim() || scopes.length === 0) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const t = await createToken(name, scopes, days);
      setCreated(t);
      setCopied("");
      setCopyFailed("");
      // 목록은 서버 판(원문 없음)으로 다시 받는다. 실패해도 만든 토큰은 위에 보이니 목록만 그대로 둔다
      const r = await listTokens().catch(() => null);
      if (r) {
        setToday(r.today);
        setItems(r.items);
      }
    } catch (err) {
      setError(toApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!target) return;
    setRevoking(true);
    setRevokeError("");
    try {
      const r = await revokeToken(target.id);
      setToday(r.today);
      setItems(r.items);
      if (created?.id === target.id) setCreated(null);
      setNotice(`「${target.name}」 토큰을 폐기했어요`);
      setTarget(null);
    } catch (err) {
      setRevokeError(toApiError(err).message);
    } finally {
      setRevoking(false);
    }
  };

  const endpoint = origin ? mcpUrl(origin) : "/api/mcp";

  return (
    <section aria-label="AI 연결" className="flex min-w-0 flex-col gap-4 rounded-[14px] border border-line p-4">
      <div>
        <h2 className="m-0 text-[14px] font-semibold">AI 연결</h2>
        <p className="mb-0 mt-1 text-[12px] leading-[1.6] text-muted">Claude Code 같은 AI 도구가 내 권한으로 스터디를 읽고 진행목표를 고칠 수 있어요. 토큰은 비밀번호처럼 다뤄 주세요.</p>
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[12px] font-semibold text-ink-3">MCP 주소</span>
        <code className={codeClass}>{endpoint}</code>
      </div>

      {created ? (
        <div className="flex min-w-0 flex-col gap-4 rounded-[12px] border border-mint bg-[#F2FBF8] p-4" aria-label="새 토큰">
          <p role="status" className="m-0 text-[13px] font-semibold" style={{ color: OK }}>
            「{created.name}」 토큰을 만들었어요 · 이 화면을 떠나면 토큰을 다시 볼 수 없어요
          </p>
          <CopyBlock label="토큰" text={created.token} copied={copied === "token"} failed={copyFailed === "token"} onCopy={() => copy("token", created.token)} />
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            <li className="flex min-w-0 flex-col gap-1">
              <CopyBlock label="① 터미널에서 연결" text={mcpAddCommand(origin, created.token)} copied={copied === "add"} failed={copyFailed === "add"} onCopy={() => copy("add", mcpAddCommand(origin, created.token))} />
              <span className="text-[12px] text-muted">모든 폴더에서 쓰도록 --scope user 로 등록해요</span>
            </li>
            <li className="flex min-w-0 flex-col gap-1">
              <CopyBlock label="② (선택) 자동 허용" text={MCP_ALLOW_SNIPPET} copied={copied === "allow"} failed={copyFailed === "allow"} onCopy={() => copy("allow", MCP_ALLOW_SNIPPET)} />
              <span className="text-[12px] leading-[1.6] text-muted">
                <code className="font-mono">~/.claude/settings.json</code> 에 넣으면 읽기·미리보기는 묻지 않아요. 적용·삭제는 계속 물어요
              </span>
            </li>
            <li className="flex min-w-0 flex-col gap-1">
              <span className="text-[12px] font-semibold text-ink-3">③ 말해 보기</span>
              <span className="text-[13px] leading-[1.6] text-ink-2">Claude Code 에서 「슥터디 연결됐어? 내 스터디 보여 줘」라고 말해 보세요</span>
            </li>
          </ol>
          <button type="button" onClick={() => setCreated(null)} className={`${ghostBtn} self-start`}>
            다 했어요 · 토큰 숨기기
          </button>
        </div>
      ) : (
        <form onSubmit={create} className="flex min-w-0 flex-col gap-3">
          <label className={labelClass}>
            토큰 이름
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="예: 노트북 Claude Code" className={fieldClass} />
          </label>
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 p-0 text-[12px] font-semibold text-ink-3">권한</legend>
            {SCOPES.map((s) => (
              <label key={s} className="flex min-h-11 cursor-pointer items-center gap-[10px] text-[14px] text-ink">
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => toggleScope(s)} className="m-0 h-5 w-5 shrink-0 cursor-pointer accent-mint" />
                {SCOPE_LABEL[s]}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-[6px]">
            <span className="text-[12px] font-semibold text-ink-3">만료</span>
            <Listbox label="토큰 만료 기간" value={String(days)} options={TOKEN_DAYS.map((d) => ({ value: String(d), label: `${d}일 뒤` }))} onChange={(v) => setDays(Number(v) as TokenDays)} />
          </div>
          {error && <p role="alert" className="m-0 text-[13px]" style={{ color: BAD }}>{error}</p>}
          <button type="submit" disabled={busy || !name.trim() || scopes.length === 0} className={primaryClass}>
            토큰 만들기
          </button>
        </form>
      )}

      {notice && <p role="status" className="m-0 text-[13px]" style={{ color: OK }}>{notice}</p>}

      <div className="flex min-w-0 flex-col gap-2">
        <span className="text-[12px] font-semibold text-ink-3">내 토큰</span>
        {loadError ? (
          <p role="alert" className="m-0 text-[13px]" style={{ color: BAD }}>{loadError}</p>
        ) : items === null ? (
          <p className="m-0 text-[13px] text-muted">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">아직 만든 토큰이 없어요</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {items.map((t) => (
              <li key={t.id} className="flex min-w-0 items-center gap-3 rounded-[12px] border border-line px-3 py-[10px]">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="break-all text-[14px] font-semibold text-ink">{t.name}</span>
                    {t.expired && <Badge bg="#FDE8E1" fg={BAD} height={20} fontSize={11} radius={6} px={7}>만료됨</Badge>}
                  </span>
                  <span className="break-all font-mono text-[12px] text-ink-3">{t.prefix}…</span>
                  <span className="text-[12px] text-muted">{t.scopes.map((s) => SCOPE_LABEL[s] ?? s).join(" · ")}</span>
                  <span className="text-[12px] text-muted">
                    {lastUsedText(t, today)} · <span style={t.expired ? { color: BAD } : undefined}>{expiresText(t, today)}</span>
                  </span>
                </div>
                <button type="button" onClick={() => (setRevokeError(""), setNotice(""), setTarget(t))} aria-label={`${t.name} 토큰 폐기`} className={`${ghostBtn} text-[#B4462B]`}>
                  폐기
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={target !== null}
        title="토큰을 폐기할까요?"
        body={target ? `「${target.name}」 토큰으로 연결한 AI 도구는 바로 접근할 수 없게 돼요. 되돌릴 수 없어요.` : ""}
        confirmLabel="폐기"
        danger
        busy={revoking}
        onConfirm={revoke}
        onCancel={() => setTarget(null)}
      >
        {revokeError && <p role="alert" className="m-0 text-[13px]" style={{ color: BAD }}>{revokeError}</p>}
      </ConfirmDialog>
    </section>
  );
}
