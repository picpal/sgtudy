import { describe, expect, it } from "vitest";
import { defaultAsk, defaultChips, firstOfNextMonth, nextMonday, sanitizeAsk } from "./chips";

const TODAY = "2026-10-23"; // 금요일

describe("기본 칩 (§4.2)", () => {
  it("다음 주 월요일 · 다음 달 1일 (오늘 기준)", () => {
    expect(nextMonday(TODAY)).toBe("2026-10-26");
    expect(nextMonday("2026-10-26")).toBe("2026-11-02"); // 월요일이면 다음 주
    expect(firstOfNextMonth("2026-12-05")).toBe("2027-01-01");
    expect(defaultChips("startDate", TODAY)).toEqual({
      field: "startDate", kind: "single", allowOther: "date",
      options: [{ label: "다음 주 월요일 (10/26)", value: "2026-10-26" }, { label: "다음 달 1일 (11/1)", value: "2026-11-01" }],
    });
  });
  it("기간·인원·공개·진행 방식", () => {
    expect(defaultChips("durationWeeks", TODAY)?.options?.map((o) => o.value)).toEqual(["4", "8", "12"]);
    expect(defaultChips("maxMembers", TODAY)?.options?.map((o) => o.label)).toEqual(["4명", "6명", "10명"]);
    expect(defaultChips("isPublic", TODAY)?.field).toBe("access");
    expect(defaultChips("style", TODAY)?.kind).toBe("multi");
    expect(defaultChips("title", TODAY)).toEqual({ field: "title", kind: "text" });
    expect(defaultAsk(["maxMembers"], TODAY)?.field).toBe("maxMembers");
    expect(defaultAsk([], TODAY)).toBeNull();
  });
});

describe("sanitizeAsk (D14)", () => {
  it("옵션 6개 · 라벨 30자 · 틀린 값 제거", () => {
    const opts = [...Array(9)].map((_, i) => ({ label: `${i + 2}명`.padEnd(40, "!"), value: String(i + 2) }));
    const a = sanitizeAsk({ field: "maxMembers", kind: "text", options: [{ label: "500명", value: "500" }, ...opts] }, {}, TODAY)!;
    expect(a.kind).toBe("single");
    expect(a.options).toHaveLength(6);
    expect(a.options![0]).toEqual({ label: "2명".padEnd(30, "!"), value: "2" });
    expect(a.allowOther).toBe("number");
  });
  it("값이 다 틀리면 기본 칩 · 과거 날짜 거름", () => {
    expect(sanitizeAsk({ field: "startDate", kind: "single", options: [{ label: "어제", value: "2026-10-22" }] }, {}, TODAY)).toEqual(defaultChips("startDate", TODAY));
  });
  it("공개/참가·진행 방식은 고정 값 집합(모델 옵션 무시)", () => {
    expect(sanitizeAsk({ field: "joinMode", kind: "single", options: [{ label: "열린 방", value: "open" }] }, {}, TODAY)).toEqual(defaultChips("access", TODAY));
    expect(sanitizeAsk({ field: "style", kind: "single" }, {}, TODAY)?.kind).toBe("multi");
  });
  it("자유 글 질문은 옵션 없이 text", () => {
    expect(sanitizeAsk({ field: "extra", kind: "text" }, {}, TODAY)).toEqual({ field: "extra", kind: "text" });
    expect(sanitizeAsk(null, {}, TODAY)).toBeNull();
  });
});
