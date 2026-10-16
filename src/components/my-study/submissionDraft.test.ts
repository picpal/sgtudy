import { describe, expect, it } from "vitest";
import { clearDraft, draftDiffers, draftKey, readDraft, writeDraft, type Draft } from "./submissionDraft";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
const D: Draft = { body: "b", links: ["https://a"], files: [{ id: "f1", name: "a.png", contentType: "image/png", size: 4, status: "ready" }], at: "2026-10-12T03:00:00.000Z" };

describe("submission draft", () => {
  it("key is per node and user", () => expect(draftKey("21", "u1")).toBe("sgtudy.subdraft.v1:21:u1"));
  it("round-trips", () => { const s = mem(); writeDraft(s, "k", D); expect(readDraft(s, "k")).toEqual(D); clearDraft(s, "k"); expect(readDraft(s, "k")).toBeNull(); });
  it("ignores broken JSON and wrong shapes", () => { const s = mem(); s.setItem("k", "{"); expect(readDraft(s, "k")).toBeNull(); s.setItem("k", JSON.stringify({ body: 1 })); expect(readDraft(s, "k")).toBeNull(); });
  it("never throws when storage is blocked or missing", () => {
    expect(readDraft(boom, "k")).toBeNull(); expect(() => writeDraft(boom, "k", D)).not.toThrow(); expect(() => clearDraft(null, "k")).not.toThrow();
  });
  it("differs from the saved submission?", () => {
    expect(draftDiffers(D, null)).toBe(true);
    expect(draftDiffers({ ...D, body: "", links: [], files: [] }, null)).toBe(false);
    expect(draftDiffers(D, { bodyMd: "b", links: ["https://a"], files: D.files })).toBe(false);
    expect(draftDiffers(D, { bodyMd: "c", links: ["https://a"], files: D.files })).toBe(true);
  });
});
