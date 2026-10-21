/**
 * 댓글 멘션 (0041 스펙 D10·§6.4) — 순수 함수만. 저장 본문은 `<@uuid>`(소문자) 토큰, 화면·입력창은 `@닉네임`.
 * 서버 comment_parse 와 같은 규칙: 토큰 정규식이 같고, 표시 길이는 토큰을 1자로 센다(코드 포인트 기준 — char_length).
 * 닉네임에는 공백이 있을 수 있어 `@텍스트` 만으로는 경계를 모른다 → 자동완성으로 고른 사람(picks)만 토큰으로 바꾼다.
 */

export const MENTION_TOKEN_RE = /<@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})>/g;

export type MentionPick = { userId: string; nickname: string };
export type MentionSegment = { type: "text"; text: string } | { type: "mention"; userId: string };

const tokenRe = () => new RegExp(MENTION_TOKEN_RE.source, "g");
const cpLen = (s: string) => [...s].length;

export const mentionToken = (userId: string) => `<@${userId.toLowerCase()}>`;

/** 본문 → 글·멘션 조각(빈 글 조각은 만들지 않는다) */
export function tokenize(body: string): MentionSegment[] {
  const out: MentionSegment[] = [];
  let last = 0;
  for (const m of body.matchAll(tokenRe())) {
    if (m.index > last) out.push({ type: "text", text: body.slice(last, m.index) });
    out.push({ type: "mention", userId: m[1] });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ type: "text", text: body.slice(last) });
  return out;
}

/** 본문의 멘션 uid — 고유, 처음 나온 순서(서버 mention_ids 와 같다) */
export const mentionIds = (body: string): string[] => [...new Set([...body.matchAll(tokenRe())].map((m) => m[1]))];

/** 표시 길이 — 토큰 = 1자, 코드 포인트 기준(서버 comment_parse.display_len). 서버는 앞뒤 공백을 걷은 뒤 센다 */
export const displayLength = (body: string): number => cpLen(body.replace(tokenRe(), "@"));

// 멘션 앞: 줄 시작·공백·여는 괄호류. 뒤: 끝·공백·글자/숫자/_ 가 아닌 것("@철수." "@철수," 는 멘션, "@철수님" 은 평문)
const BEFORE_OK = /[\s([{"'“‘]/u;
const AFTER_WORD = /[\p{L}\p{N}_]/u;

/**
 * 입력창 글 → 저장 본문. picks 의 `@닉네임` 을 **긴 닉네임부터** 토큰으로 바꾼다(닉네임 UNIQUE → 모호성 없음).
 * 사용자가 글자를 지워 깨진 멘션(닉네임이 안 맞거나 뒤에 글자가 붙음)은 평문으로 남는다. 이미 있는 토큰은 그대로 둔다
 */
export function toTokens(text: string, picks: MentionPick[]): string {
  const byLen = [...new Map(picks.map((p) => [p.nickname, p])).values()].filter((p) => p.nickname).sort((a, b) => b.nickname.length - a.nickname.length);
  if (byLen.length === 0) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "@" && (i === 0 || BEFORE_OK.test(text[i - 1]))) {
      const hit = byLen.find((p) => {
        if (!text.startsWith(p.nickname, i + 1)) return false;
        const next = text.slice(i + 1 + p.nickname.length);
        const ch = next ? String.fromCodePoint(next.codePointAt(0)!) : "";
        return ch === "" || !AFTER_WORD.test(ch);
      });
      if (hit) {
        out += mentionToken(hit.userId);
        i += 1 + hit.nickname.length;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * 저장 본문 → 입력창 글 + picks(수정 모드). people 에 없는 uid(방과 무관·탈퇴)는 토큰을 그대로 둬
 * 다시 저장해도 멘션이 사라지지 않게 한다(화면 표시는 tokenize 쪽에서 "@알 수 없음")
 */
export function toEditable(body: string, people: Record<string, { nickname: string }>): { text: string; picks: MentionPick[] } {
  const picks = new Map<string, MentionPick>();
  const text = body.replace(tokenRe(), (tok, uid: string) => {
    const nick = people[uid]?.nickname;
    if (!nick) return tok;
    picks.set(uid, { userId: uid, nickname: nick });
    return `@${nick}`;
  });
  return { text, picks: [...picks.values()] };
}

/** 칩 문구 — 맵에 없는 uid 는 "@알 수 없음"(D10) */
export const mentionLabel = (userId: string, people: Record<string, { nickname: string }>): string =>
  `@${people[userId]?.nickname || "알 수 없음"}`;

/** 자동완성 질의 최대 길이(닉네임 2~16자) — 넘으면 닫는다 */
const QUERY_MAX = 16;

/**
 * 캐럿 앞의 `@질의` (§6.4 트리거). `@` 는 줄 시작 또는 공백 다음이어야 하고(이메일 a@b 무시), 질의에 공백이 없어야 한다.
 * 한글 조합 중 글자("@ㅎ", "@하")도 그대로 질의다 — input 이벤트 값으로 부르면 된다. start = `@` 위치
 */
export function activeQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (/[\s@]/.test(query) || cpLen(query) > QUERY_MAX) return null;
  return { start: at, query };
}

/** 고른 사람으로 질의를 바꾼다 → `@닉네임 ` + 새 캐럿 */
export function insertMention(text: string, q: { start: number; query: string }, nickname: string): { text: string; caret: number } {
  const ins = `@${nickname} `;
  const end = q.start + 1 + q.query.length;
  const rest = text.slice(end).replace(/^ /, "");   // 뒤에 이미 공백이 있으면 하나로
  return { text: text.slice(0, q.start) + ins + rest, caret: q.start + ins.length };
}

// 한글 음절 → 호환 자모(ㄱ ㅏ ㄴ …). "한"(하나를 치는 중) 이 "하나" 의 접두가 되게 자모 단위로 비교한다
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
// 겹받침 → 두 자모("닭" 을 치는 중 "달ㄱ" 단계와 맞게)
const SPLIT: Record<string, string> = { ㄳ: "ㄱㅅ", ㄵ: "ㄴㅈ", ㄶ: "ㄴㅎ", ㄺ: "ㄹㄱ", ㄻ: "ㄹㅁ", ㄼ: "ㄹㅂ", ㄽ: "ㄹㅅ", ㄾ: "ㄹㅌ", ㄿ: "ㄹㅍ", ㅀ: "ㄹㅎ", ㅄ: "ㅂㅅ" };

/** 비교 키: NFC · 소문자 · 한글 음절은 자모로 */
export function searchKey(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC").toLowerCase()) {
    const c = ch.codePointAt(0)! - 0xac00;
    if (c >= 0 && c < 11172) {
      const jong = JONG[c % 28];
      out += CHO[Math.floor(c / 588)] + JUNG[Math.floor((c % 588) / 28)] + (SPLIT[jong] ?? jong);
    } else out += SPLIT[ch] ?? ch;
  }
  return out;
}

/**
 * 자동완성 후보(§6.4): 접두 일치 → 포함 일치 순, 같은 무리 안에서는 들어온 순서, 본인은 맨 뒤, 최대 limit.
 * 빈 질의("@" 만 침)는 전원
 */
export function matchMembers<T extends { userId: string; nickname: string }>(query: string, members: T[], selfId: string | null, limit = 6): T[] {
  const q = searchKey(query);
  const rank = (m: T) => {
    const k = searchKey(m.nickname);
    return k.startsWith(q) ? 0 : k.includes(q) ? 1 : -1;
  };
  return members
    .map((m, i) => ({ m, i, r: rank(m), self: m.userId === selfId }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => Number(a.self) - Number(b.self) || a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.m);
}

/**
 * keydown 이 한글 조합 중인지(§6.4 IME). 조합 확정 Enter 가 후보 선택·등록으로 새지 않게 ↑↓/Enter/Tab/Esc 처리 전에 본다.
 * Safari 는 compositionend 뒤에 keyCode 229 keydown 을 한 번 더 보내므로 isComposing 과 229 를 함께 본다
 */
export const isImeComposing = (e: { isComposing?: boolean; keyCode?: number; nativeEvent?: { isComposing?: boolean; keyCode?: number } }): boolean =>
  Boolean(e.isComposing || e.nativeEvent?.isComposing || e.keyCode === 229 || e.nativeEvent?.keyCode === 229);
