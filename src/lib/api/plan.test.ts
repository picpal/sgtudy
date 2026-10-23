import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanDoc } from "@/lib/mcp/plan-schema";

/* 방 만든 뒤 회차 적용·모집 시작 — 실패는 note 로(던지지 않음) */
const rpcMock = vi.fn();
vi.mock("./errors", async (orig) => ({ ...(await orig<typeof import("./errors")>()), rpc: (...a: unknown[]) => rpcMock(...a) }));
const { applyRoundsPlan, tryOpenRecruit, withOnly } = await import("./plan");
const { ApiException } = await import("./errors");

const plan: PlanDoc = { schema: "sgtudy.plan/v1", ops: [0, 1, 2].map((i) => ({ op: "create" as const, parent: null, title: `r${i}` })) };
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  rpcMock.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("applyRoundsPlan", () => {
  it("preview → apply 순서·인자 → applied", async () => {
    rpcMock.mockResolvedValueOnce({ ok: true, previewId: "pv1" }).mockResolvedValueOnce({ ok: true, applied: true });
    expect(await applyRoundsPlan("aws", plan)).toBe("applied");
    expect(rpcMock.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["curriculum_plan_preview", { p_slug: "aws", p_plan: plan }],
      ["curriculum_plan_apply", { p_slug: "aws", p_preview_id: "pv1" }],
    ]);
  });
  it("preview ok:false → rounds-skipped · apply 미호출 · 콘솔엔 코드만", async () => {
    rpcMock.mockResolvedValueOnce({ ok: false, errors: [{ code: "TITLE_REQUIRED", message: "비밀" }] });
    expect(await applyRoundsPlan("aws", plan)).toBe("rounds-skipped");
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toEqual(["rounds plan preview", "TITLE_REQUIRED"]);
  });
  it("RPC 예외(preview·apply) → rounds-skipped", async () => {
    rpcMock.mockRejectedValueOnce(new ApiException({ code: "NOT_LEADER", message: "m" }));
    expect(await applyRoundsPlan("aws", plan)).toBe("rounds-skipped");
    rpcMock.mockResolvedValueOnce({ ok: true, previewId: "pv1" }).mockRejectedValueOnce(new Error("network"));
    expect(await applyRoundsPlan("aws", plan)).toBe("rounds-skipped");
  });
});

describe("tryOpenRecruit", () => {
  it("room_open_recruit 성공 → applied · 실패 → recruit-skipped", async () => {
    rpcMock.mockResolvedValueOnce({ slug: "aws", status: "recruit" });
    expect(await tryOpenRecruit("aws")).toBe("applied");
    expect(rpcMock.mock.calls[0].slice(0, 2)).toEqual(["room_open_recruit", { p_slug: "aws" }]);
    rpcMock.mockRejectedValueOnce(new ApiException({ code: "ROOM_NO_LEAF_TASK", message: "m" }));
    expect(await tryOpenRecruit("aws")).toBe("recruit-skipped");
    expect(warn).toHaveBeenLastCalledWith("open recruit", "ROOM_NO_LEAF_TASK");
  });
});

describe("withOnly", () => {
  it("제외한 회차만 뺀다 · 원본 불변", () => {
    expect(withOnly(plan, new Set([1])).ops.map((o) => (o as { title: string }).title)).toEqual(["r0", "r2"]);
    expect(plan.ops).toHaveLength(3);
  });
});
