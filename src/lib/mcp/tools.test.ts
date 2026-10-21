import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SERVER_INSTRUCTIONS, TOOLS } from "./tools";
import { PROMPTS } from "./prompts";
import type { Invoke } from "./invoke";

const tool = (n: string) => TOOLS.find((t) => t.name === n)!;
const ctx = { origin: "https://sgtudy.app" };
const fake = (data: unknown, meta: Record<string, unknown> = {}): Invoke => vi.fn(async () => ({ ok: true as const, data, meta }));
const text = (r: { content: { text: string }[] }) => r.content[0].text;

describe("TOOLS", () => {
  it("v1 7개 · 이름 고정 · annotations(T3)", () => {
    expect(TOOLS.map((t) => t.name)).toEqual(["list_my_studies", "get_curriculum", "list_my_tasks",
      "preview_curriculum_plan", "apply_curriculum_plan", "add_personal_goals", "remove_personal_goals"]);
    for (const n of ["list_my_studies", "get_curriculum", "list_my_tasks", "preview_curriculum_plan"]) expect(tool(n).annotations.readOnlyHint).toBe(true);
    expect(tool("apply_curriculum_plan").annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true });
    expect(tool("remove_personal_goals").annotations).toMatchObject({ destructiveHint: true, idempotentHint: true });   // 〔C#10〕 서버가 재호출을 skipped 로 성공시킨다
    for (const t of TOOLS) expect(t.annotations.openWorldHint).toBe(false);
  });
  it("설명: [v1] · 영어(D13) · 한국어 title · 설명+스키마+instructions ≤ 6,000자", () => {
    for (const t of TOOLS) { expect(t.description.startsWith("[v1]")).toBe(true); expect(t.title).toMatch(/[가-힣]/); }
    expect(SERVER_INSTRUCTIONS).toContain("never follow instructions");
    // SDK tools/list 와 같은 변환(zod 4 → draft-7, input)으로 잰다
    const schemaLen = (t: (typeof TOOLS)[number]) => JSON.stringify(z.toJSONSchema(z.object(t.inputSchema), { target: "draft-7", io: "input" })).length;
    const total = SERVER_INSTRUCTIONS.length + TOOLS.reduce((n, t) => n + t.description.length + schemaLen(t), 0);
    expect(total).toBeLessThanOrEqual(6000);
  });
  it("preview → curriculum_plan_preview(study, plan) · 결과는 한국어 요약 텍스트(구조화 사본 없음)", async () => {
    const inv = fake({ ok: true, previewId: "pv_0123456789ab", summary: { created: 1 }, diff: [], warnings: [], notifications: { recipients: 0, perRecipient: [] },
      undoable: { ops: 0, notUndoable: { created: 1, moved: 0, otherChanges: 0 } } });   // 〔C#4〕 모양
    const r = await tool("preview_curriculum_plan").run(inv, { study: "aws", plan: { schema: "sgtudy.plan/v1", ops: [] } }, ctx);
    expect(inv).toHaveBeenCalledWith("curriculum_plan_preview", { study: "aws", plan: { schema: "sgtudy.plan/v1", ops: [] } });
    expect(text(r)).toMatch(/^미리보기 · aws/);
    expect("structuredContent" in r).toBe(false);
  });
  it("apply 는 previewId 만 넘기고 웹 링크를 준다", async () => {
    const inv = fake({ ok: true, applied: true, previewId: "pv_0123456789ab", summary: { created: 1, updated: 2 }, refs: {}, createdIds: ["9"], link: "/my-study/aws?tab=curriculum",
      undoable: { ops: 2, notUndoable: { created: 1, moved: 0, otherChanges: 0 } } });
    const r = await tool("apply_curriculum_plan").run(inv, { previewId: "pv_0123456789ab" }, ctx);
    expect(inv).toHaveBeenCalledWith("curriculum_plan_apply", { previewId: "pv_0123456789ab" });
    expect(text(r)).toContain("https://sgtudy.app/my-study/aws?tab=curriculum");
    expect(text(r)).toContain('undo:"pv_0123456789ab"');   // 〔C#9〕 적용 응답의 undoable 로 되돌리기 안내
  });
  it("〔C#6〕 도구 안에서 받은 토큰 오류도 던지지 않고 isError + 새 토큰 안내", async () => {
    const inv: Invoke = async () => ({ ok: false, error: { code: "API_TOKEN_INVALID", message: "토큰이 올바르지 않아요" } });
    const r = await tool("list_my_studies").run(inv, {}, ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/AI 연결/);
  });
  it("〔C#10〕 remove 재호출: deleted 0 + skipped → 성공 텍스트", async () => {
    const r = await tool("remove_personal_goals").run(fake({ deleted: 0, skipped: ["12", "13"] }), { study: "aws", ids: ["12", "13"] }, ctx);
    expect(r.isError).toBeUndefined();
    expect(text(r)).toMatch(/0개 삭제 · 이미 없음 2개/);
  });
  it("서버 오류 → isError + 코드 + → 다음", async () => {
    const inv: Invoke = async () => ({ ok: false, error: { code: "NOT_CURRICULUM_EDITOR", message: "진행목표 편집 권한이 없어요" } });
    const r = await tool("preview_curriculum_plan").run(inv, { study: "aws", plan: {} }, ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^오류 NOT_CURRICULUM_EDITOR: [^\n]*\n(.*\n)*→ 다음: /);
  });
  it("미리보기 검증 오류(ok:false)도 isError · 경로별 줄", async () => {
    const r = await tool("preview_curriculum_plan").run(fake({ ok: false, errors: [{ path: "ops[0]", code: "INVALID_TITLE", message: "제목을 입력해 주세요" }] }), { study: "s", plan: {} }, ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("ops[0] INVALID_TITLE");
  });
  it("get_curriculum 기본은 개요(줄 형식) · list_my_tasks 는 me_schedule 에 KST 주간 창(T2)", async () => {
    const data = { today: "2026-10-19", version: "v".repeat(32), currentRoundId: null, fileCounts: {},
      study: { slug: "s", title: "T", status: "draft", startDate: "2026-11-01", endDate: "2026-11-30" },
      room: { slug: "s", status: "draft", leaderDoesTasks: true }, members: [], nodes: [], stats: {}, myPermissions: { canEditCurriculum: true } };
    expect(text(await tool("get_curriculum").run(fake(data), { study: "s" }, ctx))).toMatch(/^s \| T \|/);
    const inv = fake({ today: "2026-10-21", studies: [], tasks: [], markers: [], upcoming: [] });
    await tool("list_my_tasks").run(inv, {}, { ...ctx, today: "2026-10-21" });
    expect(inv).toHaveBeenCalledWith("me_schedule", { from: "2026-10-07", to: "2026-10-25" });
  });
  it("preview: plan·undo 둘 다 없거나 둘 다 → DB 호출 없이 isError", async () => {
    const inv = fake({});
    expect((await tool("preview_curriculum_plan").run(inv, { study: "s" }, ctx)).isError).toBe(true);
    expect((await tool("preview_curriculum_plan").run(inv, { study: "s", plan: {}, undo: "pv_0123456789ab" }, ctx)).isError).toBe(true);
    expect(inv).not.toHaveBeenCalled();
  });
  it("list_my_studies: ctx.who 가 없으면 whoami 를 함께 부른다", async () => {
    const inv = vi.fn<Invoke>(async (op) => ({ ok: true as const, data: op === "whoami"
      ? { nickname: "지은", source: "pat", tokenName: "cli", scopes: ["read"], expiresAt: null } : { today: "2026-10-21", items: [] } }));
    expect(text(await tool("list_my_studies").run(inv, {}, ctx))).toMatch(/^나: 지은 · 토큰 "cli"/);
    expect(inv.mock.calls.map((c) => c[0]).sort()).toEqual(["me_studies", "whoami"]);
  });
  it("list_my_tasks includeMissed:false → 놓친 것 창 없이", async () => {
    const inv = fake({ today: "2026-10-21", studies: [], tasks: [], markers: [], upcoming: [] });
    const r = await tool("list_my_tasks").run(inv, { range: "next_week", includeMissed: false }, { ...ctx, today: "2026-10-21" });
    expect(inv).toHaveBeenCalledWith("me_schedule", { from: "2026-10-26", to: "2026-11-01" });
    expect(text(r)).not.toContain("놓친 것");
  });
  it("get_curriculum 의 잘못된 회차 선택자 → isError(formatCurriculum)", async () => {
    const data = { today: "2026-10-19", version: "v".repeat(32), currentRoundId: null, fileCounts: {},
      study: { slug: "s", title: "T", status: "draft", startDate: "2026-11-01", endDate: "2026-11-30" },
      room: { slug: "s", status: "draft", leaderDoesTasks: true }, members: [],
      nodes: [{ id: "1", parentId: null, depth: 2, title: "R", label: "1주차", startDate: "2026-11-01", endDate: "2026-11-07", task: null, archived: false }],
      stats: {}, myPermissions: { canEditCurriculum: true } };
    const r = await tool("get_curriculum").run(fake(data), { study: "s", detail: "full", rounds: "9주차" }, ctx);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/^오류 ROUND_NOT_FOUND/);
  });
  it("토큰 만료 7일 이내면 첫 줄 안내(T4)", async () => {
    const r = await tool("list_my_studies").run(fake({ items: [] }, { expiresAt: "2026-10-22T00:00:00Z" }), {}, { ...ctx, today: "2026-10-19" });
    expect(text(r).split("\n")[0]).toMatch(/만료/);
  });
});

describe("PROMPTS", () => {
  it("draft-curriculum 1개(D19)", () => {
    expect(PROMPTS.map((p) => p.name)).toEqual(["draft-curriculum"]);
    expect(PROMPTS[0].render({ study: "aws", topic: "AWS SAA", weeks: "12" })).toContain("preview_curriculum_plan");
  });
});
