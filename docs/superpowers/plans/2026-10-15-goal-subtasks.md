# 진행목표 회차 → 과제 (Jira 스프린트형) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 회차를 기간·대주제 그릇으로, 과제를 회차 안의 이슈로 다루게 한다 — 목록 인라인 과제 추가, 회차 화면의 과제 섹션, 회차 사이 이동(선택·드래그), 보기 모드 회차/과제 상세 화면.

**Architecture:** DB·RPC 는 그대로(`node_create`·`node_move`·`node_update`·`node_delete`). 순수 로직은 새 `src/components/my-study/rounds.ts`(vitest), URL 규칙은 `editUrl.ts` 확장, 화면 상태는 `state.ts` 에 `viewSel`·`quickAdd` 추가. 새 컴포넌트 `DetailView`·`ChildList`·`QuickAdd`·`LeafBody` 를 `tabs/` 에 두고 `CurriculumTab`·`EditView`·`TreeRow` 를 고친다.

**Tech Stack:** Next.js 16.4 (App Router) · React 19.3 · Tailwind v4 · Supabase RPC · vitest(node 환경, `src/**/*.test.ts` 만)

**Spec:** `docs/superpowers/specs/2026-10-15-goal-subtasks-design.md`

## Global Constraints

- 마이그레이션 없음. `supabase/migrations/**` 수정·추가 금지 (0013 사용 안 함).
- 사용자에게 보이는 새/바뀐 문구는 "진행목표"(옛 "커리큘럼"). 코드 식별자·`?tab=curriculum`·RPC·DB 이름은 그대로.
- 할 일 단위의 UI 용어는 "과제"(사용자의 "작업"). 새 "묶음" 생성 UI 금지 — "+" 는 회차 행(d === 0)에만.
- 새 과제 기본값 = 서버 `node_create` 기본값(공통, 회차 기간, 끝 순서). 프론트는 제목만 넘긴다.
- 이동 기간 규칙: 제출 있으면(subAll>0) 유지 · 새 회차 기간 안이면 유지 · 밖이면 오프셋·길이 유지 후 새 회차 끝으로 클램프 (`movedPeriod`).
- 한 페이지 스크롤: 새 영역에 안쪽 세로 스크롤러(`overflow-y-auto`/`max-h-*` + overflow) 금지 (h-report).
- 누르는 자리 ≥ 44px (`h-11`/`min-h-11`), `aria-label` 에 대상 제목 포함.
- 레이아웃 확인 폭: 390 / 820 / 1440, 가로 스크롤 없음.
- 구조 변경(추가·이동·순서·삭제)은 즉시 RPC, 내용 변경(제목·설명·기간·유형·담당자)은 "저장" — 기존 규칙 유지.
- 서브에이전트 금지(각 작업자 스스로 실행). Next API 를 건드리면 `node_modules/next/dist/docs/` 확인.
- 메모리: dev 서버·빌드 전에 `vm_stat | grep -E 'free|compressor'`, 한 번에 하나, 끝나면 반드시 종료. `lsof -iTCP:3700 -sTCP:LISTEN -P` 로 다른 서버 확인. dev 서버는 `npx next dev -p 3700`.
- 브라우저 확인은 `ego-browser` 스킬(자기 TaskSpace, 끝나면 finish). claude-in-chrome 금지. 브라우저 쿠키/스토리지 삭제 금지. 로그인: http://l1.localhost:3700, minsu@sgtudy.local(aws 그룹장), 이메일 OTP/비밀번호는 `.superpowers/sdd/2026-10-14-editor-ux/common.md` 참고.
- 커밋 전 게이트: `npm run lint && npx tsc --noEmit && npx vitest run`. 커밋은 `git commit -- <paths>` 로 자기 파일만. 메시지 끝 두 줄:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx
  ```
- 줄 번호는 이 플랜 작성 시점(J 작업 커밋 전) 기준 — 항상 인용한 코드 조각으로 위치를 찾는다.

## Review Focus

1. 한글 IME 조합 중 Enter(빠른 추가) — 조합 확정 Enter 가 과제를 만들거나 두 번 만들면 안 된다. → Task 5 `shouldSubmitQuickAdd` 테스트.
2. 제출이 있는 과제를 다른 회차로 옮길 때 기간이 바뀌면 지각 판정이 소급 변경된다 — 기간 유지가 기대값. → Task 1 `movedPeriod` 테스트.
3. 상세 화면을 연 채 보기↔편집 전환 후 브라우저 뒤로 가기 — 주소의 `mode` 가 화면과 어긋나면 새로고침 때 다른 화면이 열린다. → Task 3 `syncStep` 테스트.
4. 보관된 회차가 회차 선택·"+ 과제 추가" 줄에 나오면 서버 `PARENT_ARCHIVED` 오류만 받는다 — 보이지 않아야 한다. → Task 1 `roundOptions`·`withAddRows` 테스트.
5. 기존 묶음 안 과제의 "지금 회차" 표시와 이동 — 부모가 묶음이어도 회차 선택에 올바른 회차가 선택돼 있고 회차로 옮기면 회차 바로 아래로 간다. → Task 1 `roundOf` 테스트.

---

### Task 0: 선행 조건 확인 (mechanical · sonnet)

**Files:** 없음 (읽기만)

- [ ] **Step 1: J·K 가 커밋됐는지 확인**

Run: `git -C /Users/picpal/Desktop/workspace/sgtudy log --oneline -15 && git -C /Users/picpal/Desktop/workspace/sgtudy status --short`
Expected: J 커밋(목록 삭제 버튼 `removePlan`/`descendantCount` 포함 — `grep -n "export function removePlan" src/components/my-study/model.ts` 가 결과를 낸다)과 K 커밋이 있고, `src/components/my-study/**` 에 커밋 안 된 변경이 없다. 아니면 **멈추고** 컨트롤러에 보고(다른 에이전트 작업 중).

- [ ] **Step 2: 게이트 기준선**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npm run lint && npx tsc --noEmit && npx vitest run`
Expected: 모두 통과. 실패하면 멈추고 보고.

- [ ] **Step 3: 호스티드 묶음 수 확인 요청 (사용자 몫)**

컨트롤러는 사용자에게 Supabase 대시보드 SQL 에디터(읽기 전용)에서 `select count(*) from goal_nodes where depth > 3;` 결과를 요청해 기록만 한다. 결과와 무관하게 이 플랜은 진행한다(묶음은 읽기·이동만 지원).

---

### Task 1: 순수 로직 `rounds.ts` (mechanical · sonnet)

**Files:**
- Create: `src/components/my-study/rounds.ts`
- Test: `src/components/my-study/rounds.test.ts`

**Interfaces:**
- Consumes: `buildTree`, `visibleNodes`, `ParentNode`, `TreeNode` (`./model`), `addDays`, `diffDays`, `md` (`@/lib/date`), 픽스처 `AWS`, `REF_DAY` (`./fixtures`)
- Produces:
  - `currentRoundId(roots: ParentNode[], today: string): string` — 회차 id 또는 `"all"`
  - `type RoundOption = { id: string; text: string; s: string; e: string }`
  - `roundOptions(roots: ParentNode[]): RoundOption[]`
  - `roundOf(nodes: TreeNode[], n: TreeNode): ParentNode | null`
  - `movedPeriod(task: { s: string; e: string; subAll: number }, from: { s: string; e: string }, to: { s: string; e: string }): { s: string; e: string } | null` (null = 기간 유지)
  - `siblingIndex(parent: ParentNode, id: string): number`
  - `reorderIndex(parent: ParentNode, id: string, dir: -1 | 1): number | null`
  - `type ListEntry = { kind: "node"; n: TreeNode } | { kind: "add"; round: ParentNode }`
  - `withAddRows(rows: TreeNode[], roots: ParentNode[], closed: Record<string, boolean>): ListEntry[]`
  - `normalizeTitle(raw: string): string | null`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/components/my-study/rounds.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { AWS, REF_DAY } from "./fixtures";
import { EMPTY_OVERRIDES, buildTree, visibleNodes, type ParentNode } from "./model";
import { currentRoundId, movedPeriod, normalizeTitle, reorderIndex, roundOf, roundOptions, siblingIndex, withAddRows } from "./rounds";

const tree = buildTree(AWS, EMPTY_OVERRIDES, REF_DAY);
const root = (id: string) => tree.roots.find((r) => r.id === id)!;
const node = (id: string) => tree.nodes.find((n) => n.id === id)!;
const archivedTree = buildTree({ ...AWS, nodes: AWS.nodes.map((n) => (n.id === "2" || n.parentId === "2" ? { ...n, archived: true } : n)) }, EMPTY_OVERRIDES, REF_DAY);

describe("currentRoundId", () => {
  it("round containing today", () => expect(currentRoundId(tree.roots, REF_DAY)).toBe("2"));
  it("before all rounds → first upcoming", () => expect(currentRoundId(tree.roots, "2026-09-01")).toBe("1"));
  it("after all rounds → last round", () => expect(currentRoundId(tree.roots, "2026-12-01")).toBe("5"));
  it("skips archived rounds", () => expect(currentRoundId(archivedTree.roots, REF_DAY)).toBe("3"));
  it("no rounds → all", () => expect(currentRoundId([], REF_DAY)).toBe("all"));
});

describe("roundOptions", () => {
  it("label · title (period) for every live round", () => {
    const o = roundOptions(tree.roots);
    expect(o.map((x) => x.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(o[0].text).toBe("1주차 · IAM·VPC (10.01 – 10.07)");
  });
  it("excludes archived rounds", () => expect(roundOptions(archivedTree.roots).map((x) => x.id)).toEqual(["1", "3", "4", "5"]));
});

describe("roundOf", () => {
  it("task directly under a round", () => expect(roundOf(tree.nodes, node("21"))?.id).toBe("2"));
  it("task inside a legacy 묶음 still resolves to its round", () => expect(roundOf(tree.nodes, node("311"))?.id).toBe("3"));
  it("a round is its own round", () => expect(roundOf(tree.nodes, node("4"))?.id).toBe("4"));
});

describe("movedPeriod", () => {
  const r1 = { s: "2026-10-01", e: "2026-10-07" };
  const r2 = { s: "2026-10-08", e: "2026-10-14" };
  it("keeps dates when the task has submissions", () => expect(movedPeriod({ s: "2026-10-01", e: "2026-10-03", subAll: 2 }, r1, r2)).toBeNull());
  it("keeps dates already inside the new round", () => expect(movedPeriod({ s: "2026-10-10", e: "2026-10-12", subAll: 0 }, r1, r2)).toBeNull());
  it("shifts by the offset from the round start, keeping the length", () =>
    expect(movedPeriod({ s: "2026-10-04", e: "2026-10-07", subAll: 0 }, r1, r2)).toEqual({ s: "2026-10-11", e: "2026-10-14" }));
  it("clamps the end to a shorter round", () =>
    expect(movedPeriod({ s: "2026-10-01", e: "2026-10-07", subAll: 0 }, r1, { s: "2026-10-08", e: "2026-10-10" })).toEqual({ s: "2026-10-08", e: "2026-10-10" }));
  it("clamps the start when the offset runs past the round", () =>
    expect(movedPeriod({ s: "2026-10-06", e: "2026-10-07", subAll: 0 }, r1, { s: "2026-10-08", e: "2026-10-09" })).toEqual({ s: "2026-10-09", e: "2026-10-09" }));
  it("a task that started before its old round starts at the new round start", () =>
    expect(movedPeriod({ s: "2026-09-29", e: "2026-10-02", subAll: 0 }, r1, r2)).toEqual({ s: "2026-10-08", e: "2026-10-11" }));
});

describe("siblingIndex / reorderIndex", () => {
  it("index among the parent's kids", () => {
    expect(siblingIndex(root("1"), "11")).toBe(0);
    expect(siblingIndex(root("1"), "12")).toBe(1);
  });
  it("up/down targets, null at the edges", () => {
    expect(reorderIndex(root("1"), "11", -1)).toBeNull();
    expect(reorderIndex(root("1"), "11", 1)).toBe(1);
    expect(reorderIndex(root("1"), "12", -1)).toBe(0);
    expect(reorderIndex(root("1"), "12", 1)).toBeNull();
  });
});

describe("withAddRows", () => {
  const kinds = (closed: Record<string, boolean>, t = tree) =>
    withAddRows(visibleNodes(t.roots, closed), t.roots, closed).map((e) => (e.kind === "node" ? e.n.id : `+${e.round.id}`));
  it("an add row after the last visible row of every open round (묶음 children included)", () =>
    expect(kinds({})).toEqual(["1", "11", "12", "+1", "2", "21", "22", "+2", "3", "31", "311", "+3", "4", "41", "+4", "5", "51", "52", "+5"]));
  it("closed round → no add row", () => expect(kinds({ "1": true }).slice(0, 3)).toEqual(["1", "2", "21"]));
  it("empty open round still gets an add row", () => {
    const t = buildTree({ ...AWS, nodes: AWS.nodes.filter((n) => n.roundId !== "4" || n.id === "4") }, EMPTY_OVERRIDES, REF_DAY);
    expect(kinds({}, t)).toContain("+4");
    expect(kinds({}, t).slice(kinds({}, t).indexOf("4"), kinds({}, t).indexOf("4") + 2)).toEqual(["4", "+4"]);
  });
  it("archived round → no add row", () => expect(kinds({}, archivedTree)).not.toContain("+2"));
});

describe("normalizeTitle", () => {
  it("trims, rejects blank, caps at 80", () => {
    expect(normalizeTitle("  VPC 실습 ")).toBe("VPC 실습");
    expect(normalizeTitle("   ")).toBeNull();
    expect(normalizeTitle("가".repeat(90))).toHaveLength(80);
  });
});

// 타입 확인용 — ParentNode 를 실제로 쓴다
const _r: ParentNode = root("1");
void _r;
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npx vitest run src/components/my-study/rounds.test.ts`
Expected: FAIL — `Failed to resolve import "./rounds"`

- [ ] **Step 3: 구현** — `src/components/my-study/rounds.ts`

```ts
/**
 * 회차(스프린트형 그릇) ↔ 과제(이슈) 순수 로직 — 현재 회차, 회차 선택지, 이동 기간, 형제 순서, 목록의 "+ 과제 추가" 줄.
 * React 와 무관. 서버 계약: node_move 의 index 는 "자기를 뺀 새 형제" 기준 위치다.
 */
import { addDays, diffDays, md } from "@/lib/date";
import type { ParentNode, TreeNode } from "./model";

const live = (roots: ParentNode[]) => roots.filter((r) => !r.archived && !r.temp);

/** 오늘이 든 회차 → 다음 회차 → 마지막 회차 → 없으면 "all" (보드 기본 필터) */
export function currentRoundId(roots: ParentNode[], today: string): string {
  const rs = live(roots);
  if (rs.length === 0) return "all";
  return (rs.find((r) => r.s <= today && today <= r.e) ?? rs.find((r) => r.s > today) ?? rs[rs.length - 1]).id;
}

export type RoundOption = { id: string; text: string; s: string; e: string };

/** 과제 편집 화면의 "회차" 선택지 — 보관·임시 회차 제외 */
export const roundOptions = (roots: ParentNode[]): RoundOption[] =>
  live(roots).map((r) => ({ id: r.id, text: `${r.label ?? ""} · ${r.title} (${md(r.s)} – ${md(r.e)})`, s: r.s, e: r.e }));

/** 노드가 속한 회차 (묶음 안 과제도 회차로) */
export const roundOf = (nodes: TreeNode[], n: TreeNode): ParentNode | null => {
  const r = nodes.find((x) => x.id === n.roundId);
  return r && !r.leaf ? r : null;
};

/** 다른 회차로 옮길 때의 새 기간. null = 그대로 둔다 (제출 있음 · 이미 새 회차 안) */
export function movedPeriod(task: { s: string; e: string; subAll: number }, from: { s: string; e: string }, to: { s: string; e: string }): { s: string; e: string } | null {
  if (task.subAll > 0) return null;
  if (task.s >= to.s && task.e <= to.e) return null;
  const offset = Math.max(0, diffDays(from.s, task.s));
  const len = diffDays(task.s, task.e);
  let s = addDays(to.s, offset);
  if (s > to.e) s = to.e;
  let e = addDays(s, len);
  if (e > to.e) e = to.e;
  return { s, e };
}

export const siblingIndex = (parent: ParentNode, id: string): number => parent.kids.findIndex((k) => k.id === id);

/** 위(-1)/아래(+1)로 한 칸 — node_move index. 끝이면 null */
export function reorderIndex(parent: ParentNode, id: string, dir: -1 | 1): number | null {
  const i = siblingIndex(parent, id);
  const j = i + dir;
  return i < 0 || j < 0 || j >= parent.kids.length ? null : j;
}

export type ListEntry = { kind: "node"; n: TreeNode } | { kind: "add"; round: ParentNode };

/** 편집 목록: 펼쳐진(보관 아닌) 회차마다 그 회차의 마지막 보이는 행 뒤에 "+ 과제 추가" 줄 */
export function withAddRows(rows: TreeNode[], roots: ParentNode[], closed: Record<string, boolean>): ListEntry[] {
  const open = new Map(roots.filter((r) => !r.archived && !closed[r.id]).map((r) => [r.id, r]));
  const out: ListEntry[] = [];
  rows.forEach((n, i) => {
    out.push({ kind: "node", n });
    const next = rows[i + 1];
    const round = open.get(n.roundId);
    if (round && (!next || next.roundId !== n.roundId)) out.push({ kind: "add", round });
  });
  return out;
}

/** 빠른 추가 제목 — 앞뒤 공백 제거, 비면 null, 80자까지 (서버 INVALID_TITLE 와 같은 한도) */
export const normalizeTitle = (raw: string): string | null => {
  const t = raw.trim();
  return t ? t.slice(0, 80) : null;
};
```

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/picpal/Desktop/workspace/sgtudy && npx vitest run src/components/my-study/rounds.test.ts`
Expected: PASS (모든 describe)

- [ ] **Step 5: 게이트 + 커밋**

```bash
cd /Users/picpal/Desktop/workspace/sgtudy && npm run lint && npx tsc --noEmit && npx vitest run
git add src/components/my-study/rounds.ts src/components/my-study/rounds.test.ts
git commit -m "feat(my-study): rounds helpers — current round, round options, move period, add rows" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx" -- src/components/my-study/rounds.ts src/components/my-study/rounds.test.ts
```

---

### Task 2: API — `nodeCreate(title)`, `nodeMove` (mechanical · sonnet)

**Files:**
- Modify: `src/lib/api/my-study.ts:10` (`export const nodeCreate = …`)
- Test: `src/lib/api/my-study.test.ts` (끝에 describe 추가)

**Interfaces:**
- Produces:
  - `nodeCreate(slug: string, parentId: string | null, title?: string, client?: Db): Promise<Curriculum>` — title 이 있으면 `p_title` 전달
  - `nodeMove(slug: string, nodeId: string, parentId: string, index?: number, client?: Db): Promise<Curriculum>` — `node_move` (`p_index` 생략 시 null = 끝)

- [ ] **Step 1: 실패하는 테스트** — `src/lib/api/my-study.test.ts` 끝에 추가 (import 줄에 `nodeCreate, nodeMove` 와 `type Db` 추가)

```ts
import type { Db } from "./errors";
// (기존 import 에 nodeCreate, nodeMove 추가)

const fakeDb = () => {
  const calls: [string, Record<string, unknown>][] = [];
  const client = { rpc: (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return Promise.resolve({ data: { nodes: [] }, error: null }); } } as unknown as Db;
  return { calls, client };
};

describe("node RPC wrappers (goal subtasks)", () => {
  it("nodeCreate sends p_title only when given", async () => {
    const f = fakeDb();
    await nodeCreate("aws", "1", "VPC 실습", f.client);
    await nodeCreate("aws", null, undefined, f.client);
    expect(f.calls).toEqual([
      ["node_create", { p_slug: "aws", p_parent_id: "1", p_title: "VPC 실습" }],
      ["node_create", { p_slug: "aws", p_parent_id: null }],
    ]);
  });
  it("nodeMove sends parent and index (null = append)", async () => {
    const f = fakeDb();
    await nodeMove("aws", "11", "2", 0, f.client);
    await nodeMove("aws", "11", "2", undefined, f.client);
    expect(f.calls).toEqual([
      ["node_move", { p_slug: "aws", p_node_id: "11", p_parent_id: "2", p_index: 0 }],
      ["node_move", { p_slug: "aws", p_node_id: "11", p_parent_id: "2", p_index: null }],
    ]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/api/my-study.test.ts`
Expected: FAIL — `nodeMove` is not exported / 첫 테스트 인자 불일치

- [ ] **Step 3: 구현** — `src/lib/api/my-study.ts` 의 nodeCreate 줄 교체 + nodeMove 추가

```ts
export const nodeCreate = (slug: string, parentId: string | null, title?: string, client?: Db) =>
  rpc<Curriculum>("node_create", { p_slug: slug, p_parent_id: parentId, ...(title ? { p_title: title } : {}) }, client);
/** 다른 부모(회차)로 옮기기 · 같은 부모 안 순서. index = 자기를 뺀 새 형제 기준, 없으면 끝 */
export const nodeMove = (slug: string, nodeId: string, parentId: string, index?: number, client?: Db) =>
  rpc<Curriculum>("node_move", { p_slug: slug, p_node_id: nodeId, p_parent_id: parentId, p_index: index ?? null }, client);
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/api/my-study.test.ts && npx tsc --noEmit`
Expected: PASS, 타입 오류 없음 (`useCurriculumApi.ts` 의 `nodeCreate(slug, parentId)` 호출은 그대로 유효)

- [ ] **Step 5: 게이트 + 커밋**

```bash
npm run lint && npx tsc --noEmit && npx vitest run
git commit -m "feat(api): nodeCreate title, nodeMove wrapper" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx" -- src/lib/api/my-study.ts src/lib/api/my-study.test.ts
```

---

### Task 3: URL·상태 — 보기 상세(`viewSel`) 와 `?item=` mode (judgment · opus)

**Files:**
- Modify: `src/components/my-study/editUrl.ts` (`withItem`, 새 `readMode`, `syncStep`, `itemFromUrl`)
- Modify: `src/components/my-study/editUrl.test.ts`
- Modify: `src/components/my-study/state.ts` (`viewSel`, `quickAdd` 추가, `openLeaf` 제거, `goLeafPatch`, 새 `modeSwitchPatch`)
- Create: `src/components/my-study/state.test.ts`
- Modify: `src/components/my-study/MyStudyScreen.tsx` (초기 상태·URL 동기화·popstate)
- Modify: `src/components/my-study/tabs/CurriculumTab.tsx` (`openLeaf` 참조 제거만 — 화면은 Task 4)

**Interfaces:**
- Consumes: 기존 `urlStep`, `isUrlItem`, `itemTarget`
- Produces:
  - `withItem(href: string, item: string | null, mode?: CurMode): string` — 기본 `"edit"`(기존 호출 호환). `"view"` 면 `mode` 파라미터 삭제
  - `readMode(search: string): CurMode` — `mode=edit` 이면 `"edit"`, 아니면 `"view"`
  - `syncStep(url: string | null, urlMode: CurMode, open: string | null, openMode: CurMode, pushedHere: boolean): UrlStep` — 항목이 같고 mode 만 다르면 `"replace"`
  - `itemFromUrl(search: string, exists: (id: string) => boolean, canEdit: boolean): { id: string | null; mode: CurMode }`
  - `ScreenState.viewSel: string | null`, `ScreenState.quickAdd: string | null` (빠른 추가가 열린 회차 id — Task 5 가 씀)
  - `goLeafPatch(id) → { tab: "curriculum", curMode: "view", viewSel: id, editSel: null, closed: {}, calPick: null }`
  - `modeSwitchPatch(S: ScreenState, mode: CurMode): Partial<ScreenState>`
  - `CurMode` 는 `state.ts` 에 그대로; `editUrl.ts` 는 `import type { CurMode } from "./state"`

- [ ] **Step 1: 실패하는 테스트 — editUrl.test.ts 에 추가**

```ts
import { itemFromUrl, readMode, syncStep } from "./editUrl"; // 기존 import 에 합치기

describe("detail view URL (보기 ?item=)", () => {
  it("view items drop mode; edit items pin mode=edit", () => {
    expect(withItem("/my-study/aws?tab=board", "7", "view")).toBe("/my-study/aws?tab=curriculum&item=7");
    expect(withItem("/my-study/aws?tab=curriculum&mode=edit&item=7", "7", "view")).toBe("/my-study/aws?tab=curriculum&item=7");
    expect(withItem("/my-study/aws?tab=curriculum&item=7", "7", "edit")).toBe("/my-study/aws?tab=curriculum&item=7&mode=edit");
  });
  it("readMode", () => {
    expect(readMode("?tab=curriculum&mode=edit&item=7")).toBe("edit");
    expect(readMode("?tab=curriculum&item=7")).toBe("view");
  });
  it("same item, different mode → replace; otherwise urlStep", () => {
    expect(syncStep("7", "view", "7", "edit", true)).toBe("replace");
    expect(syncStep("7", "edit", "7", "edit", true)).toBe("none");
    expect(syncStep(null, "view", "7", "view", false)).toBe("push");
    expect(syncStep("7", "view", null, "view", true)).toBe("back");
    expect(syncStep("7", "view", "8", "view", true)).toBe("replace");
  });
  it("itemFromUrl: edit only for editors, missing ids → list", () => {
    const has = (id: string) => id === "7";
    expect(itemFromUrl("?item=7&mode=edit", has, true)).toEqual({ id: "7", mode: "edit" });
    expect(itemFromUrl("?item=7&mode=edit", has, false)).toEqual({ id: "7", mode: "view" });
    expect(itemFromUrl("?item=7", has, true)).toEqual({ id: "7", mode: "view" });
    expect(itemFromUrl("?item=9", has, true)).toEqual({ id: null, mode: "view" });
  });
});
```

`withItem` 의 파라미터 순서 주의: 기존 `searchParams.set` 순서(tab → mode → item)를 유지하려면 기존 키가 있으면 제자리 갱신된다. 위 세 번째 기대값(`item=7&mode=edit`)은 `mode` 가 원래 없던 주소라 끝에 붙는 결과다 — 구현이 다르면 기대값이 아니라 구현을 `URLSearchParams.set` 의미에 맞춘다.

- [ ] **Step 2: 실패하는 테스트 — `src/components/my-study/state.test.ts` 생성**

```ts
import { describe, expect, it } from "vitest";
import { INITIAL_STATE, goLeafPatch, modeSwitchPatch } from "./state";

describe("goLeafPatch", () => {
  it("opens the task detail view instead of an inline row", () =>
    expect(goLeafPatch("21")).toEqual({ tab: "curriculum", curMode: "view", viewSel: "21", editSel: null, closed: {}, calPick: null }));
});

describe("modeSwitchPatch", () => {
  it("view detail → edit opens the same item's edit view", () =>
    expect(modeSwitchPatch({ ...INITIAL_STATE, viewSel: "7" }, "edit")).toMatchObject({ curMode: "edit", editSel: "7", viewSel: null, quickAdd: null }));
  it("edit view → view opens the same item's detail", () =>
    expect(modeSwitchPatch({ ...INITIAL_STATE, curMode: "edit", editSel: "7" }, "view")).toMatchObject({ curMode: "view", viewSel: "7", editSel: null, quickAdd: null }));
  it("list stays list", () => expect(modeSwitchPatch(INITIAL_STATE, "edit")).toMatchObject({ curMode: "edit", editSel: null, viewSel: null }));
  it("temp (optimistic) items are not carried over", () =>
    expect(modeSwitchPatch({ ...INITIAL_STATE, curMode: "edit", editSel: "1.new0" }, "view")).toMatchObject({ viewSel: null }));
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/components/my-study/editUrl.test.ts src/components/my-study/state.test.ts`
Expected: FAIL — `readMode`/`syncStep`/`itemFromUrl`/`modeSwitchPatch` not exported, `goLeafPatch` 결과 불일치

- [ ] **Step 4: 구현 — editUrl.ts**

```ts
import type { CurMode } from "./state";

/** 현재 주소에서 item(·mode)만 바꾼 주소. 항목이 있으면 진행목표 탭도 싣는다. 보기 상세는 mode 를 빼고, 편집은 mode=edit */
export function withItem(href: string, item: string | null, mode: CurMode = "edit"): string {
  const u = new URL(href, "http://x");
  if (item) {
    u.searchParams.set("tab", "curriculum");
    if (mode === "edit") u.searchParams.set("mode", "edit");
    else u.searchParams.delete("mode");
    u.searchParams.set("item", item);
  } else u.searchParams.delete("item");
  const q = u.searchParams.toString();
  return `${u.pathname}${q ? `?${q}` : ""}${u.hash}`;
}

export const readMode = (search: string): CurMode => (new URLSearchParams(search).get("mode") === "edit" ? "edit" : "view");

/** urlStep + "같은 항목인데 보기↔편집만 바뀜" = replace */
export function syncStep(url: string | null, urlMode: CurMode, open: string | null, openMode: CurMode, pushedHere: boolean): UrlStep {
  const s = urlStep(url, open, pushedHere);
  return s === "none" && open !== null && isUrlItem(open) && urlMode !== openMode ? "replace" : s;
}

/** 주소 → 열 화면. 편집은 권한자만(아니면 같은 항목의 보기 상세). 없는 항목은 목록 */
export function itemFromUrl(search: string, exists: (id: string) => boolean, canEdit: boolean): { id: string | null; mode: CurMode } {
  const id = itemTarget(readItem(search), exists);
  return { id, mode: id && canEdit && readMode(search) === "edit" ? "edit" : "view" };
}
```
(`withItem` 의 기존 JSDoc 은 위 문장으로 바꾼다. 파일 머리 주석의 "편집 화면" 을 "편집·보기 상세 화면" 으로.)

`withItem` 에서 `mode` 를 지운 뒤 `set("item")` 이 기존 item 자리를 유지하므로 Step 1 의 첫 두 기대값과 맞는다. 맞지 않으면 기대값을 바꾸지 말고 구현을 고친다.

- [ ] **Step 5: 구현 — state.ts**

`ScreenState` 에서 `openLeaf` 를 지우고 추가:
```ts
  /** 보기 모드 상세 화면에 열린 항목 — 있으면 목록 대신 읽기 전용 상세 (URL ?item=, mode 없음) */
  viewSel: string | null;
  /** 편집 목록에서 빠른 추가 입력이 열린 회차 id */
  quickAdd: string | null;
```
`INITIAL_STATE` 에 `viewSel: null, quickAdd: null` (openLeaf 줄 삭제). 교체·추가:
```ts
/** 보드 카드·캘린더 팝오버·간트 리프·알림 → 그 과제의 보기 상세 */
export const goLeafPatch = (id: string): Partial<ScreenState> => ({ tab: "curriculum", curMode: "view", viewSel: id, editSel: null, closed: {}, calPick: null });

/** 보기↔편집 전환 — 열려 있던 항목은 상대 모드의 같은 항목으로 (임시 노드는 넘기지 않는다) */
export function modeSwitchPatch(S: ScreenState, mode: CurMode): Partial<ScreenState> {
  const open = mode === "edit" ? S.viewSel : S.editSel;
  const carry = open && /^\d+$/.test(open) ? open : null;
  return { curMode: mode, editSel: mode === "edit" ? carry : null, viewSel: mode === "view" ? carry : null, quickAdd: null, confirm: false, leave: null, saved: "" };
}
```

- [ ] **Step 6: 구현 — MyStudyScreen.tsx**

1. 초기 상태(`useState<ScreenState>({...})`)의 `?item=` 분기를 교체:
```ts
    // ?item=: 새로고침하면 같은 화면 — 편집 권한 + mode=edit 이면 편집 화면, 아니면 보기 상세. 없는 id 면 목록
    ...(!focusLeaf && initialItem && curriculum.nodes.some((n) => n.id === initialItem)
      ? canEditCurriculumOf({ myPermissions: curriculum.myPermissions, me: detail.me }) && initialMode === "edit"
        ? { tab: "curriculum" as const, curMode: "edit" as const, editSel: initialItem }
        : { tab: "curriculum" as const, curMode: "view" as const, viewSel: initialItem }
      : {}),
```
2. `openItem` 계산을 교체하고 mode 도 낸다:
```ts
  const editOpen = canEdit && S.tab === "curriculum" && S.curMode === "edit" && findNode(tree.nodes, S.editSel) ? S.editSel : null;
  const viewOpen = S.tab === "curriculum" && !(canEdit && S.curMode === "edit") && findNode(tree.nodes, S.viewSel) ? S.viewSel : null;
  const openItem = editOpen ?? viewOpen;
  const openMode: CurMode = editOpen ? "edit" : "view";
```
3. 동기화 effect: `urlStep(url, openItem, …)` → `syncStep(url, readMode(window.location.search), openItem, openMode, url !== null && pushed.current === url)`, `withItem(window.location.href, openItem, openMode)`, deps `[openItem, openMode]`.
4. `live.current` 에 `canEdit` 추가. popstate:
```ts
      const { S: s, tree: t, openItem: open, canEdit: ce } = live.current;
      const url = readItem(window.location.search);
      const target = itemFromUrl(window.location.search, (id) => !!findNode(t.nodes, id), ce);
      if (url && !target.id) window.history.replaceState(null, "", withItem(window.location.href, null));
      if (target.id === open && (target.id === null || (target.mode === "edit") === (s.curMode === "edit"))) return;
      if (s.curMode === "edit" && open && isDirty(s.ov, s.editSel)) {
        window.history.pushState(null, "", withItem(window.location.href, open, "edit"));
        pushed.current = open;
        update({ leave: target.mode === "edit" ? { sel: target.id } : { mode: "view" }, confirm: false });
        return;
      }
      pushed.current = target.id;
      update(
        target.id === null
          ? { editSel: null, viewSel: null, confirm: false, leave: null, saved: "" }
          : target.mode === "edit"
            ? { tab: "curriculum", curMode: "edit", editSel: target.id, viewSel: null, confirm: false, leave: null, saved: "" }
            : { tab: "curriculum", curMode: "view", viewSel: target.id, editSel: null, confirm: false, leave: null, saved: "" },
      );
```
import 에 `itemFromUrl, readMode, syncStep` 추가, 더 이상 안 쓰는 `urlStep`·`itemTarget` import 는 지운다.

- [ ] **Step 7: CurriculumTab.tsx 컴파일만 맞추기**

`go` 의 `"mode" in to` 분기를 `update({ ...modeSwitchPatch(S, to.mode) })` 로 교체(import `modeSwitchPatch`). 보기 모드 리프 클릭 `update((p) => ({ openLeaf: … }))` 은 임시로 `update({ viewSel: n.id })` 로, `{!isEdit && n.leaf && S.openLeaf === n.id && <LeafDetail n={n} />}` 줄은 삭제(상세 화면은 Task 4). `selNode` 없을 때 `viewSel` 이 있어도 지금은 목록이 보이는 상태 — Task 4 가 채운다.

- [ ] **Step 8: 통과 확인**

Run: `npx vitest run src/components/my-study && npx tsc --noEmit && npm run lint`
Expected: PASS, 타입·린트 오류 없음 (`openLeaf` 참조 0: `grep -rn openLeaf src` 결과 없음)

- [ ] **Step 9: 커밋**

```bash
npx vitest run
git commit -m "feat(my-study): view-mode item URL (?item= without mode) and viewSel state" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx" -- src/components/my-study/editUrl.ts src/components/my-study/editUrl.test.ts src/components/my-study/state.ts src/components/my-study/state.test.ts src/components/my-study/MyStudyScreen.tsx src/components/my-study/tabs/CurriculumTab.tsx
```

---

### Task 4: 보기 상세 화면 — `DetailView`, `ChildList`(보기), `LeafBody` (judgment · opus)

**Files:**
- Create: `src/components/my-study/tabs/DetailView.tsx`
- Create: `src/components/my-study/tabs/ChildList.tsx` (이 작업은 보기 모드만, Task 6 이 편집 기능을 더한다)
- Create: `src/components/my-study/tabs/LeafBody.tsx` (기존 `LeafDetail.tsx` 내용을 옮김)
- Delete: `src/components/my-study/tabs/LeafDetail.tsx`
- Modify: `src/components/my-study/tabs/CurriculumTab.tsx` (보기 모드 행 클릭 → `viewSel`, `viewNode` 가 있으면 `DetailView`, 포커스 복귀 `lastOpen` 을 두 화면이 공유)
- Modify: `src/components/my-study/model.ts` — `roundStatus` 순수 함수 추가
- Test: `src/components/my-study/model.test.ts`

**Interfaces:**
- Consumes: `ScreenState.viewSel` (Task 3), `modeSwitchPatch`, `roundOf` (Task 1), `MarkdownView` (`../MarkdownView`), `ProgressBar`, `TypeBadge`, `AvatarStack` (`../bits`), `CODE_LABEL`, `CODE_COLOR`, `myCode` (`../model`)
- Produces:
  - `roundStatus(n: { s: string; e: string }, today: string): string` — `"D-3"`(시작 전: `시작 D-n`), `"진행 중 · 마감 D-n"`, `"종료"`
  - `<ChildList parent={ParentNode} meId={string | null} onOpen={(id: string) => void} edit?={ChildListEdit} />` — `ChildListEdit` 타입은 Task 6 에서 정의(이 작업에선 prop 없음)
  - `<DetailView n={TreeNode} nodes={TreeNode[]} canEdit={boolean} onOpen={(id: string) => void} onBack={() => void} onEdit={() => void} />`
  - `<LeafBody n={LeafNode} />` — 담당자별 상태 카드 + 설명 (상세 화면 과제 본문)

- [ ] **Step 1: 실패하는 테스트 — model.test.ts 에 추가** (import 에 `roundStatus`)

```ts
describe("roundStatus (보기 상세 기간 문구)", () => {
  const r = { s: "2026-10-08", e: "2026-10-14" };
  it("before start", () => expect(roundStatus(r, "2026-10-05")).toBe("시작 D-3"));
  it("in progress", () => expect(roundStatus(r, "2026-10-12")).toBe("진행 중 · 마감 D-2"));
  it("last day", () => expect(roundStatus(r, "2026-10-14")).toBe("진행 중 · 마감 D-DAY"));
  it("ended", () => expect(roundStatus(r, "2026-10-15")).toBe("종료"));
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/components/my-study/model.test.ts` → FAIL (`roundStatus` not exported)

- [ ] **Step 3: 구현 — model.ts (`ddayLabel` 아래)**

```ts
/** 보기 상세의 기간 상태 문구 — 시작 전 / 진행 중(마감 D-n) / 종료 */
export function roundStatus(n: { s: string; e: string }, today: string): string {
  if (today < n.s) return `시작 ${dday(today, n.s)}`;
  if (today > n.e) return "종료";
  return `진행 중 · 마감 ${dday(today, n.e)}`;
}
```
Run: `npx vitest run src/components/my-study/model.test.ts` → PASS

- [ ] **Step 4: LeafBody.tsx** — `LeafDetail.tsx` 를 옮기며 바꾼다: 이름 `LeafBody`, 바깥 div 를 `className="flex flex-col gap-3"`(행 아래 들여쓰기·배경 제거), 맨 위 경로 줄 삭제(상세 화면 머리가 보여 줌), 설명 `MarkdownView` 를 `text-[14px] leading-[1.75]` 로, 설명이 비었으면 `<p className="m-0 text-[13px] text-muted">과제 설명이 아직 없어요</p>`. 담당자 카드 그리드·"아직 담당자가 없어요"·`{/* plan 06: 제출 */}` 는 그대로. `git rm src/components/my-study/tabs/LeafDetail.tsx`.

- [ ] **Step 5: ChildList.tsx (보기)**

```tsx
"use client";

import { md } from "@/lib/date";
import { useMe } from "@/lib/me";
import { TypeBadge } from "../bits";
import { CODE_COLOR, CODE_LABEL, myCode, type ParentNode } from "../model";

type Props = { parent: ParentNode; onOpen: (id: string) => void };

/** 회차(·묶음) 상세/편집 화면의 "이 회차의 과제" 목록. 내용만큼 자란다(안쪽 스크롤 없음) */
export function ChildList({ parent, onOpen }: Props) {
  const meId = useMe()?.id ?? null;
  return (
    <section aria-labelledby={`kids-${parent.id}`} className="flex flex-col gap-2">
      <h3 id={`kids-${parent.id}`} className="m-0 text-[13px] font-semibold text-ink-3">
        이 회차의 과제 {parent.kids.length}개
      </h3>
      {parent.kids.length === 0 ? (
        <p className="m-0 rounded-[12px] border border-dashed border-line-3 px-4 py-3 text-[13px] text-muted">아직 과제가 없어요</p>
      ) : (
        <ul className="m-0 flex list-none flex-col overflow-hidden rounded-[12px] border border-line p-0">
          {parent.kids.map((k) => {
            const mine = k.leaf ? myCode(k, meId) : null;
            return (
              <li key={k.id} className="border-b border-line-2 last:border-b-0" style={{ opacity: k.archived ? 0.55 : 1 }}>
                <button type="button" onClick={() => onOpen(k.id)} className="flex min-h-11 w-full flex-wrap items-center gap-x-[10px] gap-y-[2px] bg-surface px-3 py-2 text-left text-ink">
                  {k.leaf ? <TypeBadge type={k.type} /> : <span className="shrink-0 rounded-[6px] bg-slate-soft px-[7px] py-[2px] text-[11px] font-bold text-ink-3">묶음</span>}
                  <span className="min-w-0 flex-1 text-[14px] font-medium [overflow-wrap:anywhere]">{k.title}</span>
                  <span className="shrink-0 whitespace-nowrap text-[12px] text-muted">{md(k.s)} – {md(k.e)}</span>
                  {mine && <span className="shrink-0 text-[12px] font-semibold" style={{ color: CODE_COLOR[mine] }}>나 · {CODE_LABEL[mine]}</span>}
                  <span className="w-9 shrink-0 text-right text-[12px] font-semibold text-ink-2">{k.asg ? `${k.sub}/${k.asg}` : ""}</span>
                  {k.archived && <span className="shrink-0 rounded-[6px] bg-slate-soft px-[7px] py-[2px] text-[11px] font-bold text-ink-3">보관됨</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 6: DetailView.tsx**

```tsx
"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { md, weekdayKo } from "@/lib/date";
import { useToday } from "@/lib/today";
import { MarkdownView } from "../MarkdownView";
import { TypeBadge } from "../bits";
import { roundStatus, type TreeNode } from "../model";
import { ChildList } from "./ChildList";
import { LeafBody } from "./LeafBody";

type Props = { n: TreeNode; nodes: TreeNode[]; canEdit: boolean; onOpen: (id: string) => void; onBack: () => void; onEdit: () => void };

/** 보기 모드 상세 — 목록 자리를 쓰는 읽기 전용 화면 (?tab=curriculum&item=). 회차는 기간·진척·설명·과제 목록, 과제는 설명·담당자별 상태 */
export function DetailView({ n, nodes, canEdit, onOpen, onBack, onEdit }: Props) {
  const today = useToday();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const el = heading.current?.closest("section");
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  }, [n.id]);
  // 경로 조각: 회차(·묶음) — 누르면 그 상세로
  const ancestors: TreeNode[] = [];
  for (let p = nodes.find((x) => x.id === n.parentId); p; p = nodes.find((x) => x.id === p!.parentId)) ancestors.unshift(p);
  const kind = n.leaf ? "과제" : n.d === 0 ? "회차" : "묶음";
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented) onBack();
  };
  return (
    <section aria-labelledby="detail-title" onKeyDown={onKey} className="flex flex-col">
      <div className="sticky top-0 z-[2] -mx-1 flex flex-wrap items-center gap-2 border-b border-line-2 bg-surface px-1 py-3">
        <button type="button" onClick={onBack} className="inline-flex h-11 shrink-0 items-center gap-[6px] rounded-[22px] border border-line-3 bg-surface pl-3 pr-4 text-[14px] font-semibold text-ink">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          진행목표
        </button>
        <nav aria-label="경로" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 text-[13px] text-muted">
          {ancestors.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1">
              <button type="button" onClick={() => onOpen(a.id)} className="inline-flex min-h-11 items-center rounded-[8px] px-1 font-medium text-ink-2 underline-offset-2 hover:underline">
                {a.d === 0 && !a.leaf && a.label ? `${a.label} ${a.title}` : a.title}
              </button>
              <span aria-hidden="true">›</span>
            </span>
          ))}
          <span>{kind}</span>
        </nav>
        {canEdit && (
          <button type="button" onClick={onEdit} className="h-11 shrink-0 rounded-[22px] bg-navy px-5 text-[14px] font-semibold text-white">
            편집
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          {!n.leaf && n.d === 0 && n.label && <span className="shrink-0 rounded-[7px] bg-navy px-2 py-[3px] text-[12px] font-bold text-white">{n.label}</span>}
          {n.leaf && <TypeBadge type={n.type} />}
          <h2 id="detail-title" ref={heading} tabIndex={-1} className="m-0 min-w-0 text-[20px] font-bold text-ink outline-none [overflow-wrap:anywhere]">{n.title}</h2>
          {n.archived && <span className="shrink-0 rounded-[6px] bg-slate-soft px-[7px] py-[2px] text-[11px] font-bold text-ink-3">보관됨</span>}
        </div>
        <p className="m-0 text-[13px] text-ink-2">
          {md(n.s)}({weekdayKo(n.s)}) – {md(n.e)}({weekdayKo(n.e)}) · {roundStatus(n, today)}
        </p>
        {n.leaf ? (
          <LeafBody n={n} />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <ProgressBar pct={n.pct} height={8} fill={n.pct === 100 ? "#1E9E6A" : "#12A386"} className="max-w-[320px] flex-1" />
              <span className="text-[13px] text-ink-2"><b className="font-bold text-ink">{n.pct}%</b> · 제출 {n.sub}/{n.asg}</span>
            </div>
            {n.desc.trim() ? <MarkdownView src={n.desc} className="text-[14px] leading-[1.75]" /> : <p className="m-0 text-[13px] text-muted">{kind} 설명이 아직 없어요</p>}
            <ChildList parent={n} onOpen={onOpen} />
          </>
        )}
      </div>
    </section>
  );
}
```
`ProgressBar` 의 props 이름(`pct`, `height`, `fill`, `className`)은 `TreeRow.tsx` 사용처와 같다.

- [ ] **Step 7: CurriculumTab.tsx 연결**

1. `const viewNode = !isEdit ? findNode(tree.nodes, S.viewSel) : null;`
2. `lastOpen` effect 의 의존을 `const openNode = selNode ?? viewNode;` 로 바꿔 두 화면 공통(`[openNode]`, 내부 `selNode` → `openNode`).
3. `if (selNode) return …EditView…` 다음에:
```tsx
  if (viewNode)
    return (
      <div className="mt-[18px] @container">
        <DetailView key={viewNode.id} n={viewNode} nodes={tree.nodes} canEdit={canEdit}
          onOpen={(id) => update({ viewSel: id })} onBack={() => update({ viewSel: null })} onEdit={() => update(modeSwitchPatch(S, "edit"))} />
      </div>
    );
```
4. 행 `onClick`: `if (isEdit) request({ sel: n.id }); else update({ viewSel: n.id });` (보기 모드 회차·묶음도 상세. 꺾쇠 `onToggle` 은 그대로 접기).
5. 트리 `aria-label="커리큘럼"` → `"진행목표"`.

- [ ] **Step 8: 게이트**

Run: `npm run lint && npx tsc --noEmit && npx vitest run` → 통과

- [ ] **Step 9: 브라우저 확인** (Global Constraints 의 메모리·ego-browser 규칙)

`npx next dev -p 3700` → http://l1.localhost:3700/my-study/aws?tab=curriculum (보기 모드). 확인:
- 1주차 행 본문 클릭 → 회차 상세(기간·진척·설명·과제 2개), URL `?tab=curriculum&item=<id>`(mode 없음); 과제 클릭 → 과제 상세(URL replace); 경로의 "1주차 IAM·VPC" → 회차 상세; 브라우저 뒤로 → 목록 + 1주차 행 포커스; 새로고침 → 같은 상세; Esc → 목록.
- 꺾쇠는 접기만. 보드 카드 클릭 → 과제 상세. "편집" → 같은 항목 편집 화면(URL `mode=edit`), 편집→보기 Seg → 같은 항목 상세.
- 390/820/1440 스크린샷 `.superpowers/sdd/2026-10-14-editor-ux/shots/l4-detail-{round,task}-{390,820,1440}.png`. 가로 스크롤 없음(`document.documentElement.scrollWidth <= innerWidth`). 서버 종료.

- [ ] **Step 10: 커밋**

```bash
git commit -m "feat(my-study): 보기 모드 회차·과제 상세 화면 (DetailView, ChildList, LeafBody)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx" -- src/components/my-study/tabs/DetailView.tsx src/components/my-study/tabs/ChildList.tsx src/components/my-study/tabs/LeafBody.tsx src/components/my-study/tabs/LeafDetail.tsx src/components/my-study/tabs/CurriculumTab.tsx src/components/my-study/model.ts src/components/my-study/model.test.ts
```

---

### Task 5: 목록 인라인 과제 추가 — `QuickAdd`, "+ 과제 추가" 줄, `api.create` 옵션 (judgment · opus)

**Files:**
- Create: `src/components/my-study/tabs/QuickAdd.tsx`
- Modify: `src/components/my-study/rounds.ts` (+ `shouldSubmitQuickAdd`), `src/components/my-study/rounds.test.ts`
- Modify: `src/components/my-study/useCurriculumApi.ts` (`create(parentId, opts?)` → `Promise<boolean>`)
- Modify: `src/components/my-study/tabs/TreeRow.tsx` ("+" 는 `n.d === 0` 만, 비활성 "+" 제거, 라벨 "과제 추가")
- Modify: `src/components/my-study/tabs/CurriculumTab.tsx` (`withAddRows` 로 렌더, `S.quickAdd`, 안내 문구)

**Interfaces:**
- Consumes: `withAddRows`, `ListEntry`, `normalizeTitle` (Task 1), `nodeCreate(slug, parentId, title)` (Task 2), `ScreenState.quickAdd` (Task 3)
- Produces:
  - `shouldSubmitQuickAdd(e: { key: string; isComposing: boolean; keyCode?: number }): boolean`
  - `CurriculumApi.create: (parentId: string | null, opts?: { title?: string; open?: boolean }) => Promise<boolean>` — `open` 기본 true(기존: 편집 화면 열기). `open:false` 면 목록에 머물고 토스트 없음
  - `<QuickAdd round={ParentNode} indent={number} onAdd={(title: string) => Promise<boolean>} onClose={() => void} />`
  - `<AddRow round={ParentNode} indent={number} onOpen={() => void} />` (QuickAdd.tsx 에서 export)

- [ ] **Step 1: 실패하는 테스트 — rounds.test.ts 에 추가**

```ts
import { shouldSubmitQuickAdd } from "./rounds"; // 기존 import 에 합치기

describe("shouldSubmitQuickAdd (IME)", () => {
  it("plain Enter submits", () => expect(shouldSubmitQuickAdd({ key: "Enter", isComposing: false })).toBe(true));
  it("Enter that confirms a Hangul composition does not", () => expect(shouldSubmitQuickAdd({ key: "Enter", isComposing: true })).toBe(false));
  it("Safari reports composition Enter as keyCode 229", () => expect(shouldSubmitQuickAdd({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(false));
  it("other keys never submit", () => expect(shouldSubmitQuickAdd({ key: "a", isComposing: false })).toBe(false));
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/components/my-study/rounds.test.ts` → FAIL

- [ ] **Step 3: 구현 — rounds.ts 끝**

```ts
/** 빠른 추가 Enter — 한글 조합을 확정하는 Enter(isComposing, Safari keyCode 229)는 제출이 아니다 */
export const shouldSubmitQuickAdd = (e: { key: string; isComposing: boolean; keyCode?: number }): boolean =>
  e.key === "Enter" && !e.isComposing && e.keyCode !== 229;
```
Run → PASS

- [ ] **Step 4: useCurriculumApi.create 옵션**

타입: `create: (parentId: string | null, opts?: { title?: string; open?: boolean }) => Promise<boolean>;`
본문:
```ts
  const create = useCallback(
    async (parentId: string | null, opts: { title?: string; open?: boolean } = {}) => {
      const key = parentId ?? "root";
      const open = opts.open ?? true;
      const label = opts.title ?? (parentId ? "새 과제" : "새 회차");
      // open: 응답을 기다리지 않고 임시 노드의 편집 화면을 연다(서버 id 가 오면 그 항목으로). 빠른 추가(open:false)는 목록에 임시 행만
      update((p) => {
        const list = p.ov.added[key] ?? [];
        return {
          ov: { ...p.ov, added: { ...p.ov.added, [key]: [...list, label] } },
          closed: parentId ? { ...p.closed, [parentId]: false } : p.closed,
          ...(open ? { editSel: tempId(key, list.length), confirm: false, saved: "" } : {}),
        };
      });
      try {
        const cur = await nodeCreate(slug, parentId, opts.title);
        const created = cur.nodes.filter((n) => n.parentId === parentId).sort((a, b) => b.sortOrder - a.sortOrder)[0];
        setCur(cur);
        update((p) => ({ ov: { ...p.ov, added: popOne(p.ov.added, key) }, ...(open ? { editSel: created?.id ?? null, justAdded: created?.id ?? null } : {}) }));
        if (open) toast({ text: parentId ? "새 과제를 추가했어요" : "새 회차를 추가했어요", tone: "ok" }); // Q3-14 — 빠른 추가는 행이 나타나는 것으로 충분
        router.refresh();
        return true;
      } catch (e) {
        update((p) => ({ ov: { ...p.ov, added: popOne(p.ov.added, key) }, ...(open ? { editSel: p.editSel && !isUrlItem(p.editSel) ? null : p.editSel } : {}) }));
        fail(e);
        return false;
      }
    },
    [slug, setCur, update, fail, router, toast],
  );
```
임시 행 제목이 입력한 제목이 되도록 `ov.added` 에 `label` 을 넣는다(기존 `tempChild` 가 제목으로 쓴다).

- [ ] **Step 5: QuickAdd.tsx**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { ParentNode } from "../model";
import { normalizeTitle, shouldSubmitQuickAdd } from "../rounds";

const indentCls = "w-[calc(var(--d)*22px)] shrink-0 max-sm:w-[calc(var(--d)*10px)]";

/** 펼친 회차 끝의 "+ 과제 추가" 줄 */
export function AddRow({ round, indent, onOpen }: { round: ParentNode; indent: number; onOpen: () => void }) {
  return (
    <div className="flex min-h-11 items-center border-b border-line-2 bg-surface pl-2 pr-3">
      <span className={indentCls} style={{ "--d": indent } as React.CSSProperties} />
      <button type="button" data-add-task={round.id} onClick={onOpen} aria-label={`${round.title}에 과제 추가`} className="inline-flex h-11 items-center gap-[6px] rounded-[10px] px-2 text-[13px] font-semibold text-mint">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        과제 추가
      </button>
    </div>
  );
}

/** 빠른 추가 — Enter 로 만들고 입력은 다음 과제를 위해 비운 채 열어 둔다. Esc·빈 입력에서 포커스가 나가면 닫힘 */
export function QuickAdd({ round, indent, onAdd, onClose }: { round: ParentNode; indent: number; onAdd: (title: string) => Promise<boolean>; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [last, setLast] = useState("");
  useEffect(() => input.current?.focus(), []);
  const submit = async () => {
    const t = normalizeTitle(text);
    if (!t) return;
    setText("");
    const ok = await onAdd(t);
    if (ok) setLast(t);
    else setText((cur) => cur || t); // 실패하면 쓴 글자를 되살린다 (그새 새로 쓴 게 있으면 그대로)
  };
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-2 border-b border-line-2 bg-surface-2 py-1 pl-2 pr-3">
      <span className={indentCls} style={{ "--d": indent } as React.CSSProperties} />
      <input
        ref={input}
        type="text"
        value={text}
        maxLength={80}
        aria-label={`${round.title}에 추가할 과제 제목`}
        placeholder="과제 제목을 쓰고 Enter · Esc 닫기"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (shouldSubmitQuickAdd({ key: e.key, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) {
            e.preventDefault();
            void submit();
          }
        }}
        onBlur={() => {
          if (!text.trim()) onClose();
        }}
        className="h-11 min-w-0 flex-1 rounded-[10px] border border-line-3 bg-surface px-3 text-[14px] text-ink"
      />
      <span role="status" className="sr-only">{last ? `추가했어요: ${last}` : ""}</span>
    </div>
  );
}
```

- [ ] **Step 6: TreeRow.tsx**

`canAdd`/`cantAdd`/`addTip` 를 교체:
```ts
  // "+" 는 회차에만 — 과제 아래 과제(묶음)는 만들지 않는다 (2단계: 회차 → 과제)
  const canAdd = isEdit && !n.leaf && n.d === 0 && !n.archived;
  const addTip = `${n.title}에 과제 추가`;
```
`{cantAdd && (…disabled 버튼…)}` 블록을 삭제. J 가 추가한 삭제 버튼의 자리 맞춤(과제 행은 "+" 자리를 비워 둠)이 회차 아닌 부모(묶음) 행에도 적용되는지 확인하고, 묶음 행은 과제 행과 같은 정렬을 쓰도록 J 의 조건(`n.leaf`)을 `!canAdd` 기준으로 바꾼다.

- [ ] **Step 7: CurriculumTab.tsx**

1. import `withAddRows` (`../rounds`), `AddRow, QuickAdd` (`./QuickAdd`).
2. 편집 모드 목록은 엔트리로 렌더:
```tsx
const entries = isEdit ? withAddRows(rows, tree.roots, S.closed) : rows.map((n) => ({ kind: "node" as const, n }));
const openAdd = (id: string) => update((p) => ({ quickAdd: id, closed: { ...p.closed, [id]: false } }));
```
`rows.map((n) => …)` 를 `entries.map((e) => e.kind === "add" ? (S.quickAdd === e.round.id ? <QuickAdd key={`qa-${e.round.id}`} round={e.round} indent={1} onAdd={(t) => api.create(e.round.id, { title: t, open: false })} onClose={() => { update({ quickAdd: null }); document.querySelector<HTMLButtonElement>(`[data-add-task="${CSS.escape(e.round.id)}"]`)?.focus(); }} /> : <AddRow key={`add-${e.round.id}`} round={e.round} indent={1} onOpen={() => openAdd(e.round.id)} />) : (<div key={e.n.id}>…기존 TreeRow…</div>))` 로 바꾼다. (onClose 의 포커스는 다음 렌더 후 AddRow 가 생기므로 `requestAnimationFrame(() => …focus())` 로 감싼다.)
3. TreeRow `onAddChild={!n.leaf && n.d === 0 ? () => openAdd(n.id) : undefined}` — 행 "+" 는 더 이상 `request({add})` 를 쓰지 않는다. `addChild` 상수 삭제. (`Leave` 의 `{ add }` 는 "회차 추가" 가 계속 쓴다.)
4. 안내 문구(`회차나 과제를 누르면 편집 화면이 열려요 · 추가하면 바로 편집 화면으로 이동해요.`)를 `회차는 기간·대주제, 과제는 회차 안의 할 일이에요 · 회차나 과제를 누르면 편집 화면이 열려요.` 로.
5. 편집 모드에서 행을 눌러 편집 화면으로 갈 때 `quickAdd` 를 닫는다: `go` 의 `sel` 분기에 `quickAdd: null` 추가.

- [ ] **Step 8: 게이트** — `npm run lint && npx tsc --noEmit && npx vitest run` → 통과

- [ ] **Step 9: 브라우저 확인**

aws 편집 모드: 1주차 "+" → 목록 그대로, 1주차 끝 입력 포커스 → "보안 그룹 정리" Enter → 1주차 안 들여쓴 새 행(공통, 10.01–10.07, 담당 4명) + 입력 비고 포커스 유지 → 한글 조합 중 Enter 로 확정만 될 뿐 생성 안 됨 → 연속 3개 추가 → Esc 닫힘 + "과제 추가" 버튼 포커스. 접힌 회차의 "+" → 펼쳐지며 입력. 묶음(3주차 › 로드밸런서 비교) 행에 "+" 없음. "회차 추가" 는 여전히 회차 편집 화면. 390/1440 스크린샷 `shots/l5-quickadd-{390,1440}.png`. 만든 테스트 과제는 삭제(J 의 행 삭제 버튼). 서버 종료.

- [ ] **Step 10: 커밋**

```bash
git commit -m "feat(my-study): inline 과제 추가 under each 회차 (Enter for the next one)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx" -- src/components/my-study/tabs/QuickAdd.tsx src/components/my-study/rounds.ts src/components/my-study/rounds.test.ts src/components/my-study/useCurriculumApi.ts src/components/my-study/tabs/TreeRow.tsx src/components/my-study/tabs/CurriculumTab.tsx
```

---

### Task 6: 편집 화면 — 회차의 과제 섹션, 경로 링크, 회차 선택(이동) (judgment · opus)

**Files:**
- Modify: `src/components/my-study/useCurriculumApi.ts` (`move`)
- Modify: `src/components/my-study/tabs/ChildList.tsx` (편집 기능 `edit` prop)
- Modify: `src/components/my-study/tabs/EditView.tsx`
- Modify: `src/components/my-study/tabs/CurriculumTab.tsx` (EditView 에 `nodes`·`roots` 전달)
- Modify: `src/components/my-study/rounds.ts`, `rounds.test.ts` (+ `moveNote`)

**Interfaces:**
- Consumes: `roundOptions`, `roundOf`, `movedPeriod`, `reorderIndex`, `moveNote` (Task 1·이 작업), `isDirty` (`../model`), `md` (`@/lib/date`), `nodeMove` (Task 2), `QuickAdd`/`AddRow` (Task 5), J 의 `removePlan` (`../model`), `InlineConfirm`
- Produces:
  - `CurriculumApi.move: (id: string, parentId: string, index?: number, period?: { s: string; e: string } | null, okText?: string) => Promise<boolean>`
  - `CurriculumApi.remove: (id: string, opts?: { stay?: boolean }) => Promise<void>` — `stay` 면 열린 편집 화면(`editSel`)을 바꾸지 않는다(회차 화면에서 과제 삭제)
  - `moveNote(task: { s: string; e: string; subAll: number }, period: { s: string; e: string } | null, sameRound: boolean): string` — 미리보기 문구
  - `type ChildListEdit = { onMove: (id: string, dir: -1 | 1) => void; onRemove: (id: string) => void; onAdd: (title: string) => Promise<boolean>; busy: string | null; canAdd: boolean }`

- [ ] **Step 1: 실패하는 테스트 — rounds.test.ts 에 추가**

```ts
import { moveNote } from "./rounds";

describe("moveNote (회차 선택 미리보기)", () => {
  it("same round", () => expect(moveNote({ s: "2026-10-01", e: "2026-10-03", subAll: 0 }, null, true)).toBe(""));
  it("submissions keep dates", () => expect(moveNote({ s: "2026-10-01", e: "2026-10-03", subAll: 1 }, null, false)).toBe("제출이 있어 기간은 그대로예요"));
  it("inside the new round", () => expect(moveNote({ s: "2026-10-10", e: "2026-10-12", subAll: 0 }, null, false)).toBe("기간은 그대로예요"));
  it("shifted", () => expect(moveNote({ s: "2026-10-04", e: "2026-10-07", subAll: 0 }, { s: "2026-10-11", e: "2026-10-14" }, false)).toBe("옮기면 기간이 10.11 – 10.14 로 바뀌어요"));
});
```

- [ ] **Step 2: 실패 확인 → 구현 (rounds.ts 끝) → 통과**

```ts
/** 과제 편집 화면 회차 선택 아래 미리보기 */
export function moveNote(task: { s: string; e: string; subAll: number }, period: { s: string; e: string } | null, sameRound: boolean): string {
  if (sameRound) return "";
  if (period) return `옮기면 기간이 ${md(period.s)} – ${md(period.e)} 로 바뀌어요`;
  return task.subAll > 0 ? "제출이 있어 기간은 그대로예요" : "기간은 그대로예요";
}
```
Run: `npx vitest run src/components/my-study/rounds.test.ts` → PASS

- [ ] **Step 3: useCurriculumApi.move**

타입에 `move` 추가, import `nodeMove`:
```ts
  const move = useCallback(
    async (id: string, parentId: string, index?: number, period?: { s: string; e: string } | null, okText?: string) => {
      try {
        setCur(await nodeMove(slug, id, parentId, index));
      } catch (e) {
        fail(e);
        return false;
      }
      if (period) {
        try {
          setCur(await nodeUpdate(slug, id, { startDate: period.s, endDate: period.e }));
        } catch (e) {
          // 이동은 됐다 — 기간만 옛 값 (마이그레이션 없이 두 번 부르는 대가)
          toast({ text: `옮겼지만 기간은 바꾸지 못했어요 · ${toApiError(e).message}`, tone: "bad" });
          router.refresh();
          return true;
        }
      }
      if (okText) toast({ text: okText, tone: "ok" });
      router.refresh();
      return true;
    },
    [slug, setCur, fail, router, toast],
  );
```
`return { create, remove, archive, save, move };`

- [ ] **Step 4: ChildList 편집 기능**

`Props` 에 `edit?: ChildListEdit` 추가하고 타입을 export. `edit` 이 있으면 각 줄을 `<div className="flex flex-wrap items-center">` 로 감싸 본문 버튼(기존) 오른쪽에 버튼 묶음:
```tsx
{edit && (
  <span className="flex shrink-0 items-center pr-1">
    <IconBtn label={`${k.title} 위로`} disabled={i === 0 || k.archived || edit.busy !== null} onClick={() => edit.onMove(k.id, -1)} d="m6 15 6-6 6 6" />
    <IconBtn label={`${k.title} 아래로`} disabled={i === parent.kids.length - 1 || k.archived || edit.busy !== null} onClick={() => edit.onMove(k.id, 1)} d="m6 9 6 6 6-6" />
    <IconBtn label={`${k.title} 삭제`} tone="warn" disabled={edit.busy !== null} onClick={() => setAsk(k.id)} d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </span>
)}
```
`aria-busy={edit?.busy === k.id}` 를 `<li>` 에. `IconBtn`(같은 파일):
```tsx
const IconBtn = ({ label, d, onClick, disabled, tone }: { label: string; d: string; onClick: () => void; disabled?: boolean; tone?: "warn" }) => (
  <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
    className={`flex h-11 w-11 items-center justify-center rounded-[10px] bg-transparent disabled:opacity-35 ${tone === "warn" ? "text-warn" : "text-ink-3"}`}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
  </button>
);
```
삭제 확인: `ChildList` 안에 `const [ask, setAsk] = useState<string | null>(null)`; 삭제 버튼(위 코드의 `onClick={() => setAsk(k.id)}`)을 누르면 그 줄 아래에 `removePlan(k)` 결과로 `<InlineConfirm text={plan.text} onCancel={() => setAsk(null)} actions={[{ label: plan.label, onClick: () => { setAsk(null); edit.onRemove(k.id); }, tone: "danger" }]} />` (plan.kind "none" 이면 문구만). 실제 `edit.onRemove` 는 확인 후에만 부른다. 목록 끝에 `edit.canAdd` 이면 `AddRow`/`QuickAdd`(indent 0, 로컬 state `adding`)를 둔다. 섹션 제목 오른쪽에는 편집일 때 진척 요약 "진척률 {pct}%".

- [ ] **Step 5: EditView**

Props 에 `nodes: TreeNode[]; roots: ParentNode[]` 추가(CurriculumTab 이 `tree.nodes`, `tree.roots` 전달).
1. 문구: 뒤로 버튼 "커리큘럼" → "진행목표". 부모 줄 `하위 항목 {n.kids.length}개 · 진척률 {n.pct}%` → `과제 {n.kids.length}개 · 진척률 {n.pct}%`, 보조 글 `과제의 제출 수 ÷ 담당 건수로 자동 집계돼요`.
2. 부모(회차·묶음)면 기간 줄과 기간 경고 다음, 설명 앞에:
```tsx
{!n.leaf && (
  <ChildList
    parent={n}
    onOpen={(cid) => request({ sel: cid })}
    edit={{
      busy,
      canAdd: !n.archived && !n.temp,
      onAdd: (t) => api.create(n.id, { title: t, open: false }),
      onRemove: (cid) => void api.remove(cid, { stay: true }),
      onMove: (cid, dir) => {
        const to = reorderIndex(n, cid, dir);
        if (to === null) return;
        setBusy(cid);
        void api.move(cid, n.id, to).finally(() => setBusy(null));
      },
    }}
  />
)}
```
`const [busy, setBusy] = useState<string | null>(null);`. 회차 화면에서 과제를 지우면 그 회차 편집 화면에 머물러야 한다 → `api.remove(id, opts?: { stay?: boolean })` 로 확장: `stay` 면 `editSel` 을 건드리지 않는다(낙관적 `removed` 와 실패 롤백은 그대로, 실패 시 `editSel: id` 대신 유지).
3. 부모면 설명 편집기 `minHeight` 를 `"420px"` 로(과제 섹션이 위에 있어 `100dvh − 520px` 가 맞지 않음). 리프는 기존 값.
4. 경로를 링크로: `crumb` 문자열 대신 조상 배열(DetailView 와 같은 방식 `ancestors`)을 만들어 막대 안 h2 의 내용과 좁은 화면 `<p>` 를 `<nav aria-label="경로">` 버튼들로 교체(각 `min-h-11`, `onClick={() => request({ sel: a.id })}`, temp 면 disabled). h2 는 sr-only 로 남겨 `aria-labelledby` 유지: `<h2 id="edit-view-title" ref={heading} tabIndex={-1} className="sr-only">항목 편집 · {kind} {n.title}</h2>` — 포커스 이동은 기존대로 h2.
5. 리프면 기간·유형 줄에 회차 선택:
```tsx
{n.leaf && (() => {
  const cur = roundOf(nodes, n);
  const opts = roundOptions(roots);
  const dirty = isDirty(S.ov, id);
  return (
    <label className={`${label} min-w-0 flex-[0_1_300px] max-sm:flex-[1_1_100%]`}>
      회차
      <select
        value={cur?.id ?? ""}
        disabled={n.temp || n.archived || dirty || busy !== null}
        onChange={(e) => {
          const to = roots.find((r) => r.id === e.target.value);
          if (!to || !cur || to.id === cur.id && n.parentId === cur.id) return;
          const period = to.id === cur.id ? null : movedPeriod(n, cur, to);
          setBusy(id);
          void api
            .move(id, to.id, undefined, period, period ? `${to.label}로 옮겼어요 · 기간 ${md(period.s)} – ${md(period.e)}` : `${to.label}로 옮겼어요`)
            .then((ok) => ok && update({ saved: moveNote(n, period, false) }))
            .finally(() => setBusy(null));
        }}
        className={`${field} min-w-0 bg-surface px-[10px] text-[14px]`}
      >
        {opts.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}
      </select>
      <span className="text-[12px] font-medium text-muted">
        {dirty ? "저장한 뒤 옮길 수 있어요" : `${n.parentId !== cur?.id ? `지금: ${n.crumb} · ` : ""}다른 회차로 옮기면 그 회차 기간에 맞춰져요 · 제출이 있으면 기간은 그대로예요`}
      </span>
    </label>
  );
})()}
```
네이티브 `<select>` 는 고르기 전에 항목별 미리보기를 보여 줄 수 없다. 그래서 (a) dirty 가 아닐 때 select 아래 문구 자리에 고정 안내 "다른 회차로 옮기면 그 회차 기간에 맞춰져요 · 제출이 있으면 기간은 그대로예요" 를 보이고(묶음 안 과제면 그 앞에 `지금: {n.crumb}` 를 한 줄 더), (b) 이동 성공 후 `update({ saved: moveNote(n, period, false) })` 로 고정 막대의 저장 문구 자리에 결과를 알린다(토스트 `okText` 와 함께).
6. 이동 후 편집 화면은 같은 과제 그대로(새 회차 경로로 바뀜). 목록으로 돌아가면 새 회차 아래에 있다.

- [ ] **Step 6: 게이트** — `npm run lint && npx tsc --noEmit && npx vitest run` → 통과

- [ ] **Step 7: 브라우저 확인**

aws 편집 모드:
- 1주차 행 클릭 → 회차 편집 화면에 "이 회차의 과제 2개" 섹션(줄: 유형·제목·기간·sub/asg, 위/아래/삭제 44px) → 아래로 → 순서 바뀜(목록에서도) → 섹션 "과제 추가" → Enter 로 2개 추가 → 한 개 삭제(줄 안 확인) → 화면 그대로. 회차 제목을 고친 상태(미저장)에서도 추가·순서 동작, 과제 열기는 미저장 확인.
- 과제 편집 화면 경로 "1주차 IAM·VPC" → 회차 편집 화면. 
- 새로 만든 과제(제출 없음)를 회차 선택으로 2주차로 → 토스트 "2주차로 옮겼어요 · 기간 10.08 – 10.14", 목록·간트·보드(2주차 필터)에 새 위치. 제출 있는 "IAM 정책 이해" 를 2주차로 → 기간 그대로, 다시 1주차로 되돌림. 제목 수정 중엔 select 비활성 + 문구.
- 3주차 묶음 안 "ALB vs NLB 실습" 선택값 = 3주차, 문구 "지금: 3주차 고가용성 아키텍처 › 로드밸런서 비교" (옮기지 말 것 — 시드 보존).
- 390/820/1440 스크린샷 `shots/l6-round-edit-{390,820,1440}.png`, `shots/l6-task-move-1440.png`. 가로 스크롤 없음, 안쪽 세로 스크롤 없음. 테스트 데이터 원복. 서버 종료.

- [ ] **Step 8: 커밋**

```bash
git commit -m "feat(my-study): 회차 편집 화면 과제 섹션, 경로 링크, 회차 선택으로 과제 이동" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx" -- src/components/my-study/useCurriculumApi.ts src/components/my-study/tabs/ChildList.tsx src/components/my-study/tabs/EditView.tsx src/components/my-study/tabs/CurriculumTab.tsx src/components/my-study/rounds.ts src/components/my-study/rounds.test.ts
```

---

### Task 7: 보드 기본 = 현재 회차 (mechanical · sonnet)

**Files:**
- Modify: `src/components/my-study/MyStudyScreen.tsx` (초기 `bRound`)

**Interfaces:**
- Consumes: `currentRoundId` (Task 1), `buildTree`, `EMPTY_OVERRIDES` (`./model`)

- [ ] **Step 1: 테스트** — 동작은 Task 1 의 `currentRoundId` 테스트가 고정한다. 추가 테스트 없음(초기화 한 줄).

- [ ] **Step 2: 구현** — `useState<ScreenState>({ ...INITIAL_STATE, … })` 에 추가:
```ts
    // 보드는 스프린트 보드처럼 현재 회차로 시작 (칩으로 "전체" 선택 가능)
    bRound: currentRoundId(buildTree(curriculum, EMPTY_OVERRIDES, curriculum.today).roots, curriculum.today),
```
import `currentRoundId` from `./rounds`, `EMPTY_OVERRIDES` from `./model`. (`useState` 초기값은 첫 렌더에만 계산된다.)

- [ ] **Step 3: 게이트 + 확인** — `npm run lint && npx tsc --noEmit && npx vitest run`. dev 서버가 이미 다른 작업 확인용으로 떠 있지 않으면 브라우저 확인은 Task 9 에 맡긴다.

- [ ] **Step 4: 커밋**

```bash
git commit -m "feat(my-study): board starts on the current 회차" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx" -- src/components/my-study/MyStudyScreen.tsx
```

---

### Task 8: 목록 드래그 — 순서 변경·회차 사이 이동 (judgment · opus)

**Files:**
- Modify: `src/components/my-study/rounds.ts`, `rounds.test.ts` (+ `dropPlan`)
- Create: `src/components/my-study/tabs/useRowDrag.ts`
- Modify: `src/components/my-study/tabs/TreeRow.tsx` (핸들에 포인터 이벤트, 과제·묶음 행만)
- Modify: `src/components/my-study/tabs/CurriculumTab.tsx` (드롭 표시선, `api.move`)

**Interfaces:**
- Consumes: `movedPeriod`, `roundOf`, `siblingIndex` (Task 1), `api.move` (Task 6)
- Produces:
  - `dropPlan(nodes: TreeNode[], dragId: string, overId: string, half: "top" | "bottom"): { parentId: string; index: number } | null`
  - `useRowDrag(onDrop: (dragId: string, overId: string, half: "top" | "bottom") => void): { handleProps: (id: string) => React.HTMLAttributes<HTMLElement>; over: { id: string; half: "top" | "bottom" } | null; dragging: string | null }`

- [ ] **Step 1: 실패하는 테스트 — rounds.test.ts**

```ts
import { dropPlan } from "./rounds";

describe("dropPlan (드래그 놓기 → node_move)", () => {
  const ns = tree.nodes;
  it("reorder inside a round", () => {
    expect(dropPlan(ns, "12", "11", "top")).toEqual({ parentId: "1", index: 0 });
    expect(dropPlan(ns, "11", "12", "bottom")).toEqual({ parentId: "1", index: 1 });
  });
  it("no-op drops return null", () => {
    expect(dropPlan(ns, "11", "11", "top")).toBeNull();
    expect(dropPlan(ns, "11", "12", "top")).toBeNull();
  });
  it("onto a task of another round → that position", () => expect(dropPlan(ns, "11", "21", "top")).toEqual({ parentId: "2", index: 0 }));
  it("onto a round row → end of that round", () => expect(dropPlan(ns, "11", "4", "bottom")).toEqual({ parentId: "4", index: 1 }));
  it("rounds are not draggable; a node never drops into itself", () => {
    expect(dropPlan(ns, "1", "21", "top")).toBeNull();
    expect(dropPlan(ns, "31", "311", "top")).toBeNull();
  });
  it("archived targets are refused", () => {
    const t = buildTree({ ...AWS, nodes: AWS.nodes.map((n) => (n.id === "4" || n.parentId === "4" ? { ...n, archived: true } : n)) }, EMPTY_OVERRIDES, REF_DAY);
    expect(dropPlan(t.nodes, "11", "4", "bottom")).toBeNull();
    expect(dropPlan(t.nodes, "11", "41", "top")).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 (rounds.ts 끝) → 통과**

```ts
/**
 * 드래그로 놓은 자리 → node_move(parent, index). 회차 행 위 = 그 회차 끝, 과제·묶음 행 위 = 그 형제 사이(top 앞 / bottom 뒤).
 * 회차는 끌 수 없고, 자기·자기 하위·보관 대상 위에는 놓을 수 없다. 제자리면 null.
 */
export function dropPlan(nodes: TreeNode[], dragId: string, overId: string, half: "top" | "bottom"): { parentId: string; index: number } | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const drag = byId.get(dragId);
  const over = byId.get(overId);
  if (!drag || !over || drag.d === 0 || drag.archived || over.archived || drag.temp || over.temp) return null;
  for (let p: TreeNode | undefined = over; p; p = p.parentId ? byId.get(p.parentId) : undefined) if (p.id === drag.id) return null;
  let parent: ParentNode;
  let index: number;
  if (!over.leaf && over.d === 0) {
    parent = over;
    index = over.kids.filter((k) => k.id !== drag.id).length;
  } else {
    const p = over.parentId ? byId.get(over.parentId) : undefined;
    if (!p || p.leaf || p.archived) return null;
    parent = p;
    const sibs = p.kids.filter((k) => k.id !== drag.id);
    index = sibs.findIndex((k) => k.id === over.id) + (half === "bottom" ? 1 : 0);
  }
  if (drag.parentId === parent.id && siblingIndex(parent, drag.id) === index) return null;
  return { parentId: parent.id, index };
}
```
Run: `npx vitest run src/components/my-study/rounds.test.ts` → PASS

- [ ] **Step 3: useRowDrag.ts**

```ts
"use client";

import { useCallback, useRef, useState } from "react";

type Half = "top" | "bottom";

/** 행 핸들 포인터 드래그 (마우스·펜 전용, ≥640 에서만 핸들이 보인다). 키보드·터치 대체: 회차 화면 위/아래 · 과제 화면 회차 선택 */
export function useRowDrag(onDrop: (dragId: string, overId: string, half: Half) => void) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; half: Half } | null>(null);
  const overRef = useRef(over);
  overRef.current = over;
  const handleProps = useCallback(
    (id: string) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        if (e.pointerType === "touch" || e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(id);
      },
      onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-node]");
        if (!row) return setOver(null);
        const r = row.getBoundingClientRect();
        setOver({ id: row.dataset.node!, half: e.clientY < r.top + r.height / 2 ? "top" : "bottom" });
      },
      onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
        e.currentTarget.releasePointerCapture(e.pointerId);
        const o = overRef.current;
        setDragging(null);
        setOver(null);
        if (o && o.id !== id) onDrop(id, o.id, o.half);
      },
      onPointerCancel: () => {
        setDragging(null);
        setOver(null);
      },
    }),
    [onDrop],
  );
  return { handleProps, over, dragging };
}
```

- [ ] **Step 4: TreeRow / CurriculumTab 연결**

TreeRow props 에 `dragHandle?: React.HTMLAttributes<HTMLElement>; dropHint?: "top" | "bottom" | null; dragging?: boolean` 추가. 핸들 `<span title="드래그해서 순서 변경" …>` 을: 회차 행(d === 0)이면 지금처럼 장식만(끌 수 없음 — `title` 을 지우고 `invisible` 로 자리만 유지), 그 외엔 `{...dragHandle}` 과 `touch-none` 을 단다. 행 div 에 `dropHint` 가 있으면 `shadow-[inset_0_2px_0_#12A386]`(top) / `shadow-[inset_0_-2px_0_#12A386]`(bottom), `dragging` 이면 `opacity-50`.
CurriculumTab:
```ts
const onDrop = useCallback((dragId: string, overId: string, half: "top" | "bottom") => {
  const plan = dropPlan(tree.nodes, dragId, overId, half);
  const n = findNode(tree.nodes, dragId);
  if (!plan || !n) return;
  const from = roundOf(tree.nodes, n);
  const to = roundOf(tree.nodes, findNode(tree.nodes, plan.parentId)!);
  const period = from && to && from.id !== to.id ? movedPeriod(n, from, to) : null;
  void api.move(dragId, plan.parentId, plan.index, period, from && to && from.id !== to.id ? (period ? `${to.label}로 옮겼어요 · 기간 ${md(period.s)} – ${md(period.e)}` : `${to.label}로 옮겼어요`) : undefined);
}, [tree.nodes, api]);
const drag = useRowDrag(onDrop);
```
편집 모드 TreeRow 에 `dragHandle={drag.handleProps(n.id)} dropHint={drag.over?.id === n.id ? drag.over.half : null} dragging={drag.dragging === n.id}`. (`md` 는 `@/lib/date`.)

- [ ] **Step 5: 게이트** — `npm run lint && npx tsc --noEmit && npx vitest run` → 통과 (react-hooks 린트: `overRef.current = over` 렌더 중 대입이 걸리면 `useEffect(() => { overRef.current = over; })` 로)

- [ ] **Step 6: 브라우저 확인** — 1440 aws 편집 모드: 새 과제 하나를 만들어 1주차 안 위아래로 끌기 → 순서 반영, 4주차 회차 행 위에 놓기 → 4주차 끝 + 기간 토스트, 묶음 "로드밸런서 비교" 행은 끌 수 있으나 회차 행은 안 끌림, 자기 하위 위 놓기 무시. 390 에서 핸들 숨김 확인. 테스트 데이터 삭제. 스크린샷 `shots/l8-drag-1440.png`. 서버 종료.

- [ ] **Step 7: 커밋**

```bash
git commit -m "feat(my-study): drag 과제 to reorder or move between 회차 (desktop)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx" -- src/components/my-study/rounds.ts src/components/my-study/rounds.test.ts src/components/my-study/tabs/useRowDrag.ts src/components/my-study/tabs/TreeRow.tsx src/components/my-study/tabs/CurriculumTab.tsx
```

---

### Task 9: 통합 확인 + 보고 (judgment · opus)

**Files:**
- Create: `.superpowers/sdd/2026-10-14-editor-ux/l-report.md`

- [ ] **Step 1: 게이트** — `npm run lint && npx tsc --noEmit && npx vitest run` → 통과. 결과 숫자 기록.

- [ ] **Step 2: 수용 기준 1~13 을 브라우저에서 하나씩** (spec §5). 계정: 그룹장 minsu(http://l1.localhost:3700), 위임 편집자 jieun(http://l2.localhost:3700 — 편집 권한 부여 상태 확인), 일반 멤버(보기 상세만, "편집" 버튼 없음). 각 기준마다 통과/실패와 스크린샷 경로를 표로.

- [ ] **Step 3: 측정** — 390/820/1440 × (목록 보기, 목록 편집+빠른 추가 열림, 회차 상세, 과제 상세, 회차 편집, 과제 편집): `scrollWidth <= innerWidth`, 안쪽 세로 스크롤러 0(`[...document.querySelectorAll('*')].filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight && e !== document.scrollingElement })` 결과가 알림 드롭다운·모달 외 0), 새 버튼 `getBoundingClientRect().height >= 44`.

- [ ] **Step 4: 남은 "커리큘럼" 문구** — `grep -rn "커리큘럼" src/components/my-study --include=*.tsx` 결과 중 이번에 손댄 파일의 사용자 문구가 남아 있으면 "진행목표" 로 고치고(조사 주의), 손대지 않은 파일은 보고서에 목록만.

- [ ] **Step 5: 보고서** — `l-report.md`: 커밋 목록, 게이트, 수용 기준 표, 측정 결과, 남은 이슈(예: 이동+기간 두 번 호출의 비원자성, 호스티드 묶음 수), 테스트 데이터 정리 여부. 서버 종료·TaskSpace finish.

- [ ] **Step 6: 커밋(남은 문구 수정이 있을 때만)**

```bash
git commit -m "copy(my-study): 진행목표 wording in touched views" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BkL4bbbGPNh1oeJiQMkqMx" -- <바꾼 파일들>
```

---

## 실행 순서·모델

| Task | 내용 | 모델 | 선행 |
|---|---|---|---|
| 0 | 선행 조건 | sonnet | J·K 커밋 |
| 1 | rounds.ts 순수 로직 | sonnet | 0 |
| 2 | API nodeCreate(title)·nodeMove | sonnet | 0 |
| 3 | URL·상태(viewSel, mode) | opus | 1 |
| 4 | 보기 상세 화면 | opus | 3 |
| 5 | 목록 빠른 추가 | opus | 1, 2, 3 |
| 6 | 편집 화면 과제 섹션·경로·회차 이동 | opus | 4, 5 |
| 7 | 보드 현재 회차 | sonnet | 1 |
| 8 | 드래그 | opus | 6 |
| 9 | 통합 확인·보고 | opus | 전부 |

순차 실행(같은 파일 `CurriculumTab.tsx`·`EditView.tsx`·`useCurriculumApi.ts` 를 여러 작업이 고친다 — 병렬 금지).
